# Phase 38: `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Inv #12.5) — Research

**Researched:** 2026-05-27
**Domain:** Selector-based calldata pattern detection + APPEND-ONLY block emission + sister-repo skill coordination (v2.5 close-out)
**Confidence:** HIGH on `enableModule` selector + emission-site identification (verified directly against viem + repo source); HIGH on Phase 37 informational-line precedent (read directly from `prepare_safe_tx_*.ts`); HIGH on skill-integrity SHA-pin shape (read directly from `src/security/skill-integrity.ts`); MEDIUM on sister-repo SKILL.md insertion point (locally-installed copy at `~/.claude/skills/vaultpilot-preflight/SKILL.md` is from a different upstream — `vaultpilot-security-skill` — than the planning-time template; the canonical insertion point is the v1.3 release template, NOT what is currently in personal scope)

## Summary

Phase 38 promotes three pre-staged informational `delegatecall: YES — Phase 38 will hard-trigger…` lines (Phase 37 — at `prepare_safe_tx_propose.ts:538`, `prepare_safe_tx_approve.ts:411`, `prepare_safe_tx_execute.ts:540`) into two APPEND-ONLY hard-trigger blocks emitted as response text alongside `PREPARE RECEIPT` / `CHECKS PERFORMED` / `LEDGER DISPLAY`. The blocks are NOT structured refusals — both `enableModule` and `delegatecall` are legitimate Safe operations. They are **instructions to the agent** to invoke `get_verification_artifact({ handle })`, surface the pasteableBlock to the user, and obtain confirmation before requesting `userDecision: "send"`. Skill-side enforcement (Inv #12.5 in `vaultpilot-preflight` v1.4) is the load-bearing defense; the MCP block is the trigger signal.

The phase is two plans: Plan 38-01 ships main-repo selector detection + block emission + SECURITY.md Inv #12.5 codification + skill-integrity v1.4 SHA pin; Plan 38-02 cuts the sister-repo `szhygulin/vaultpilot-preflight-skill` v1.4 minor release with Inv #12.5 HALT step inserted in `SKILL.md`. Strict sequential ordering (38-01 before 38-02) — same coordination pattern as Phase 9's 09-01 → 09-02.

**Primary recommendation:** Add `src/protocols/safe.ts` (selector constant `ENABLE_MODULE_SELECTOR = "0x610b5925"` + `decodeEnableModuleCalldata` + `isEnableModuleCalldata`) — per-protocol module convention mirrors `src/protocols/erc20.ts` / `aave-v3.ts`. Add two APPEND-ONLY block constants `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` + `HARD_TRIGGER_DELEGATECALL_TEMPLATE` to `src/signing/blocks.ts` end-of-file with `{MODULE_ADDRESS}` / `{SAFE_ADDRESS}` / `{HANDLE}` placeholders. **REPLACE** the three Phase 37 informational `delegatecall: YES` lines at the propose / approve / execute sites with conditional emission of the hard-trigger block(s) in the response `text` (DF-1 LOCKED REPLACE). `preview_send.ts` Safe-execute branch (search anchor `isSafeExecTransaction`) re-emits the blocks at the EVM dispatch site using inner-decoded SafeTx fields surfaced by Phase 37's `decodeSingleSafeExecTransaction`. SECURITY.md adds a new `## Phase 38 — `enableModule` + delegatecall hard-trigger (Inv #12.5)` section with v2.5 close-out summary. Skill-integrity pin migrates from v1.3.x to v1.4 — **REPLACEMENT, not additive** (DF-2 LOCKED REPLACE — current code at `src/security/skill-integrity.ts:60-61` is a SINGLE pinned hex, not a list; promoting to a multi-version list is out of scope for Phase 38 and would change the integrity-check shape).

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Detection at prepare time on BOTH propose AND approve.** `enableModule` selector match on inner SafeTx `data` (not the outer `execTransaction` calldata) → emit `[HARD-TRIGGER — MODULE ENABLE]`. `operation === "delegatecall"` (semantic string from `PreparedTxSafeTypedData.operation`) → emit `[HARD-TRIGGER — DELEGATECALL]`.
- **Re-emission at `preview_send` for execute path.** When `record.isSafeExecTransaction === true`, decode the inner SafeTx (already done by Phase 37 at lines 1893-1897) and re-emit the matching hard-trigger block(s). Defense-in-depth against cross-signer scenarios where the executor's MCP session lacks the propose-side state.
- **Composite scenario emits BOTH blocks in document order: MODULE ENABLE first (narrower selector match), DELEGATECALL second (broader operation match). Never combine.** The skill's Inv #12.5 enforcement keys on the block titles independently.
- **APPEND-ONLY template constants in `src/signing/blocks.ts`**: `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` + `HARD_TRIGGER_DELEGATECALL_TEMPLATE` with `{MODULE_ADDRESS}` / `{SAFE_ADDRESS}` / `{HANDLE}` placeholders. Substitution at emission site.
- **`src/protocols/safe.ts` is NEW** — per-protocol convention mirrors `erc20.ts` / `aave-v3.ts`. Exports `ENABLE_MODULE_SELECTOR = "0x610b5925" as const` + `decodeEnableModuleCalldata(data: Hex): { module: Address }` + `isEnableModuleCalldata(data: Hex): boolean`.
- **Decode failure surfaces as `INVALID_INPUT + hint = "SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed."`** Structured refusal because calldata is broken, not because of the operation.
- **No new `payloadFingerprint` fixture.** Trigger fires on detection, not on a new cryptographic-binding shape. Existing Fixtures SAFE-A..D anchor propose/approve/execute fingerprints from Phase 37.
- **Fixture SAFE-G** anchors the selector + decoder regression: hardcoded `0x610b5925<padded-address-arg>` literal in `test/protocols-safe.test.ts` (new file). NO `beforeAll`-snapshot per CLAUDE.md convention.
- **SECURITY.md gets a new section** for Inv #12.5 codification + v2.5 milestone close-out summary referencing Phase 37 + Phase 38 as the v2.5 trust-pipeline completion. Format mirrors existing Inv numbering precedent (e.g. Inv #6b for decoded-recipient assertion at preview).
- **Documented accepted residual:** a non-skill-using agent can ignore the block. MCP cannot enforce — the hard-trigger is an instruction to the agent, not a server-side gate. Skill-side enforcement is load-bearing; MCP-side block is the trigger signal.
- **Plan 38-02 ships ONLY to sister `szhygulin/vaultpilot-preflight-skill` repo.** v1.4 minor bump (NOT v1.3.x patch) — Inv #12.5 is a new HALT condition.
- **Inv #12.5 insertion in SKILL.md** AFTER Step 0 self-check, BEFORE Step 1 dispatch validation. HALT condition: agent must call `get_verification_artifact`, surface output, AND obtain user confirmation of second-LLM check before assisting with `submit_safe_tx_signature({ userDecision: "send" })` or `send_transaction` against this handle.
- **MCP-side skill-integrity SHA pin extended to v1.4.** Pin captured at sister-repo `git tag v1.4` time and committed in Plan 38-01 (NOT 38-02). Plan 38-02 cuts the release tag.
- **Sister-repo CI workflow still deferred** (Plan 09-01 W-1 carries forward — gh OAuth lacks `workflow` scope; same constraint at Plan 38-02).
- **Cross-plan ordering: 38-01 BEFORE 38-02 strict-sequential.** Plan 38-01 commits the SHA pin computed from local sister-repo content (no remote tag required at plan-01 commit time); Plan 38-02 tags the release as the final v2.5 close-out step.
- **FROZEN at Phase 38:** `src/signing/payload-fingerprint.ts` (no new domain tag), `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` three gates, Phase 37 cryptographic-binding fixtures SAFE-A/B/C/D. Phase 38's emission sites in `prepare_safe_tx_propose.ts` / `_approve.ts` / `_execute.ts` / `preview_send.ts` are APPEND-ONLY block additions — the existing PREPARE RECEIPT / CHECKS PERFORMED / LEDGER DISPLAY blocks are not modified.

### Claude's Discretion

- Internal helper names: `decodeEnableModuleCalldata`, `isEnableModuleCalldata`, `shouldEmitModuleEnableHardTrigger`, `shouldEmitDelegateCallHardTrigger`. Names follow Phase 37's `decodeSingleSafeExecTransaction` convention.
- Exact wording inside the hard-trigger block templates (sketches in CONTEXT; final wording tightened during execute).
- Test file split: `test/protocols-safe.test.ts` (selector + decoder) PLUS extensions to existing `test/prepare-safe-tx-propose.test.ts` / `test/prepare-safe-tx-approve.test.ts` / `test/preview-send.safe-execute.test.ts` (block emission). Researcher recommends the MERGE-INTO-EXISTING approach (see § Topic 8).
- Whether `preview_send` re-emission also covers `submit_safe_tx_signature` (which already has access to the SafeTx from Tx Service). Default per CONTEXT: **NO** — submit is a signature post, not a user-confirmation gate.

### Deferred Ideas (OUT OF SCOPE)

- `disableModule(address,address)` detection (selector `0xe009cfde`) — contraction not expansion; v2.5.x.
- `changeMasterCopy` proxy-upgrade detection — `delegatecall` discriminator already covers.
- Per-module risk-scoring (curated `KNOWN_SAFE_MODULES_*` allowlist) — v2.5.x.
- Safe Account Abstraction (4337) — v3.x.
- Hosted MCP / multi-tenant — v3.0.
- Explicit `MultiSend` non-CallOnly selector detection — captured by `delegatecall` discriminator at Phase 38.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-09 | `prepare_safe_tx_propose` (and `_approve`) detect `enableModule(...)` calldata pattern at preview time and emit `[HARD-TRIGGER — MODULE ENABLE]` instructing the agent to run `get_verification_artifact` AND surface the result to the user before requesting `userDecision`; `operation: 1` (delegateCall) hard-triggers `[HARD-TRIGGER — DELEGATECALL]` block; both blocks are NOT structured refusals; skill-side Inv #12.5 encoded in companion `vaultpilot-preflight` skill (sister-repo coordinated bump) | §Topic 1 (selector verification); §Topic 2 (emission site selection); §Topic 3 (template constant naming); §Topic 4 (SHA-pin extension pattern); §Topic 5 (sister-repo coordination precedent); §Topic 6 (SKILL.md insertion point); §Topic 7 (SECURITY.md §Inv #12.5 placement); §Topic 8 (test file split); §Topic 9 (Fixture SAFE-G literal); §Topic 10 (Ledger CAL framing) |

## Project Constraints (from CLAUDE.md)

- **APPEND-ONLY block templates as exported constants in `src/signing/blocks.ts`** with `{PLACEHOLDER}` substitution at emission site (verified by audit of existing 30+ template constants in `src/signing/blocks.ts` — all follow this exact pattern).
- **Per-protocol module under `src/protocols/`** — confirmed pattern: `erc20.ts`, `aave-v3.ts`, `weth9.ts`, `uniswap-v3.ts`, `compound-v3.ts`, `morpho-blue.ts`, `lido.ts`, `eigenlayer.ts`, `rocketpool.ts`, `curve.ts`, `bridge-decoders/*`, plus chain-specific subsets for solana / tron / btc. Phase 38 adds `safe.ts`.
- **Cryptographic-binding fixtures pinned as hardcoded `0x…` literals** — Phase 38 Fixture SAFE-G is selector + decoder regression, NOT a fingerprint shape (no new cryptographic binding), so simpler literal.
- **Tool descriptions are agent routing prompts.** Hard-trigger blocks read as INSTRUCTIONS in the same voice as Plan 04-03's `[AGENT TASK — RUN THESE CHECKS NOW]` block — verified by reading `AGENT_TASK_TEMPLATE` at `src/signing/blocks.ts:116-148`.
- **Stderr for diagnostics, stdout for MCP protocol.** Hard-trigger blocks ride in the response `text` payload (stdout/MCP-protocol surface), not stderr.
- **No private key material crosses any boundary.** Phase 38 reads only the SafeTx `data` field (calldata) and the `operation` discriminator (semantic string) — neither contains key material.
- **`src/config/contracts.ts` is the single source of truth for canonical contract addresses.** Phase 38 reads `safeAddress` from runtime state, not from contracts.ts (the Safe proxy is per-user). NO contract registry change.
- **GSD Workflow Enforcement.** All edits via planned phase work — applies to Plan 38-01 / 38-02 execution.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `enableModule` selector match + decode | Protocol (`src/protocols/safe.ts`) | — | Per-protocol decoder convention; pure function; no I/O |
| Hard-trigger block template constants | Signing (`src/signing/blocks.ts`) | — | Format-fanout-sentinel SOT; APPEND-ONLY exported constants with `{PLACEHOLDER}` substitution |
| Hard-trigger block emission at propose / approve | Tool (`src/tools/prepare_safe_tx_propose.ts` + `_approve.ts`) | Protocol (selector decode); Signing (template) | Tools own response composition; emission site adjacent to existing CHECKS PERFORMED block |
| Hard-trigger block re-emission at preview | Tool (`src/tools/preview_send.ts`) | Signing (`safe-exec-decode.ts` — inner SafeTx decode already done by Phase 37) | Defense-in-depth; cross-signer execute path catches the propose-skipped case |
| Skill-integrity SHA pin update to v1.4 | Security (`src/security/skill-integrity.ts`) | — | Single-constant SHA replacement; same shape as Plan 09-02 v1.3 pin |
| SECURITY.md Inv #12.5 codification | Documentation | — | New section + Inv numbering + accepted-residual entry + v2.5 close-out summary |
| Sister-repo `vaultpilot-preflight` v1.4 SKILL.md update | OUT-OF-MAIN-REPO (sister `szhygulin/vaultpilot-preflight-skill`) | — | Plan 38-02 ships ONLY to sister repo; tag v1.4 cut as v2.5 close-out |

## Standard Stack

### Core (already installed; Phase 38 adds no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | `^2.48.x` (verified at `/home/szhygulin/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/node_modules/viem`) | `decodeFunctionData`, `parseAbi`, `toFunctionSelector` for `enableModule(address)` decoder | Already the canonical EVM client; mirrors Phase 37 `safe-exec-decode.ts` pattern |

**Installation:** None. All required functionality is in the existing dependency set.

**Version verification:** `viem.toFunctionSelector('enableModule(address)')` returns `0x610b5925` — verified at `[VERIFIED: node REPL with installed viem 2.48.11]`. Phase 37 `EXEC_TRANSACTION_SELECTOR = "0x6a761202"` confirmed identical via the same path.

## Package Legitimacy Audit

**Not applicable.** Phase 38 adds zero new npm packages. All required functionality is provided by `viem` — an existing dependency vetted across Phases 1-37. No `[SLOP]` / `[SUS]` / `[OK]` triage required.

## Topic-by-Topic Findings

### Topic 1 — `enableModule` ABI/selector verification

**Finding:** `enableModule(address module)` selector is `0x610b5925`. **CONFIRMED.**

**Evidence:**
- `[VERIFIED: viem.toFunctionSelector('enableModule(address)') === '0x610b5925']` — computed in-session via installed `viem@2.48.11` at `/home/szhygulin/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/node_modules/viem`.
- CONTEXT.md lock value matches (line 11, 81, 91-93, 183-184).
- Cross-check: `disableModule(address,address)` selector is `0xe009cfde` (matches CONTEXT line 227 deferred-ideas reference).
- Cross-check: `execTransaction(...)` selector is `0x6a761202` — matches Phase 37 `EXEC_TRANSACTION_SELECTOR` at `src/signing/safe-exec-decode.ts:36`.

**Note on conflicting source:** The Safe docs page at `https://docs.safe.global/reference-smart-account/modules/enableModule` (fetched 2026-05-27) returned a hallucinated selector value (`0xa7e28ebd`) when WebFetched and asked to extract the selector — but the canonical viem-computed selector is `0x610b5925`. **Discount the docs-page WebFetch output; trust the viem computation.** This is a routine docs-vs-implementation drift; the contract source is authoritative.

**ABI consistency v1.3.0 vs v1.4.1:** Phase 37 RESEARCH §Summary established that "Safe v1.3.0 and v1.4.1 share byte-identical EIP-712 typehashes" — and the `enableModule(address)` signature is identical across both versions (single `address` parameter; no overloads). The selector `0x610b5925` works for both supported versions. **No version branching required.**

**Decoder approach:** `viem.decodeFunctionData` with `parseAbi(["function enableModule(address module)"])` — directly mirrors `src/signing/safe-exec-decode.ts:91` pattern. Decode failure (truncated calldata) throws → caller catches → structured refusal with `INVALID_INPUT + hint`.

**Recommendation:** Constant `ENABLE_MODULE_SELECTOR = "0x610b5925" as const` in `src/protocols/safe.ts`. Decoder `decodeEnableModuleCalldata(data: Hex): { module: Address }` and predicate `isEnableModuleCalldata(data: Hex): boolean` (computes `data.slice(0, 10).toLowerCase() === ENABLE_MODULE_SELECTOR`). Lowercase normalization on the predicate is load-bearing — calldata can ship from upstream sources in mixed case (per Phase 37 RESEARCH on viem Hex normalization).

**Confidence:** HIGH — selector verified directly via the installed viem version.

### Topic 2 — Block emission site selection (DF-1 resolution)

**Finding:** REPLACE the three Phase 37 informational `delegatecall: YES` lines with conditional hard-trigger block emission (one block per emission site, not duplicated). Add a SECOND conditional block for `enableModule` detection at the same sites.

**Phase 37 lines being replaced:**
- `src/tools/prepare_safe_tx_propose.ts:537-539` — `...(operationStr === "delegatecall" ? ["  delegatecall:     YES — Phase 38 will hard-trigger second-LLM check here (informational at Phase 37)"] : []),` (inside the `checksPerformed` block array).
- `src/tools/prepare_safe_tx_approve.ts:409-413` — same shape, slightly different prose.
- `src/tools/prepare_safe_tx_execute.ts:538-542` — same shape, slightly different prose.

Each line is INSIDE the `checksPerformed` text-block array (joined with `"\n"`). The line currently emits *as part of CHECKS PERFORMED*. Phase 38 should:
1. **REMOVE the line from the CHECKS PERFORMED block** (the prose explicitly says "informational at Phase 37" — Phase 38's job is to promote it).
2. **EMIT the hard-trigger block as a SEPARATE text block** appended after the existing `prepareReceipt` / `checksPerformed` / `ledgerDisplay` blocks. Pattern: `const text = [prepareReceipt, checksPerformed, ledgerDisplay, ...hardTriggerBlocks].join("\n\n");`

**Why REPLACE not ADD-ALONGSIDE:**
- The Phase 37 informational line explicitly says "Phase 38 will hard-trigger second-LLM check here". Keeping it alongside the hard-trigger block creates redundant prose ("delegatecall: YES" appears twice in the same response — once as inline note, once as a full block). The user-facing UX is cleaner with the line removed.
- The CHECKS PERFORMED block is a STATIC list of verified facts. The hard-trigger block is a SEPARATE call-to-action ("Agent: do X"). Mixing them in CHECKS PERFORMED collapses the semantic distinction.
- Phase 37 SUMMARY frames the line as a TEMPORARY placeholder; Phase 38 is the explicit promotion site.

**Emission site map:**

| Site | File:Line (Phase 37 anchor) | Action | Block(s) emitted (conditions) |
|------|------|--------|------------------------------|
| Propose | `src/tools/prepare_safe_tx_propose.ts:537-539` (informational `delegatecall: YES` line) | REPLACE the line; emit blocks AFTER `ledgerDisplay` | MODULE ENABLE if `isEnableModuleCalldata(data)` AND `to === safeAddress`; DELEGATECALL if `operationStr === "delegatecall"` |
| Approve | `src/tools/prepare_safe_tx_approve.ts:409-413` (informational line) | REPLACE; emit AFTER `ledgerDisplay` | Same conditions as propose; `data` and `to` come from the Tx Service SafeTx record fetched at line 248-251 |
| Execute (prepare) | `src/tools/prepare_safe_tx_execute.ts:538-542` (informational line) | REPLACE; emit AFTER the existing WARN block at line 554-563 (since WARN-block precedes prepareReceipt per Phase 37 line 572-577 join order — keep hard-trigger blocks AT THE END for visual prominence) | Same conditions; `data` and `operation` come from `decodeSingleSafeExecTransaction(tx.data)` already computed at line ~290-294 |
| Execute (preview re-emit) | `src/tools/preview_send.ts:1893-1968` (existing safe-execute composite-tx branch) | ADD a new conditional block emission INSIDE the existing `if (record.tx.data !== "0x" && record.tx.data.slice(0,10) === EXEC_TRANSACTION_SELECTOR) { ... }` arm AFTER `safeExecDecodeBlock` + `safeExecWarnBlock` are built (i.e. after line 1961) | Same conditions; uses `innerDecoded.data` for `isEnableModuleCalldata` check and `innerDecoded.operation === 1` for delegatecall check. The composite-tx preview block (`safeExecDecodeBlock`) is already in the response text join — the hard-trigger block is APPENDED to the join. |

**Composite emission order (CONTEXT lock § Decisions, "Composite scenario"):** MODULE ENABLE first, DELEGATECALL second. Never combine. Skill keys on titles independently.

**`enableModule` `to === safeAddress` guard:** The hard-trigger fires when a Safe is calling `enableModule` ON ITSELF (the SafeTx's `to` field matches `safeAddress`). A SafeTx calling `enableModule` on a *different* Safe is not the threat model — it's a different Safe's owner-management call, irrelevant to this Safe. Recommended: in `shouldEmitModuleEnableHardTrigger`, require BOTH (a) selector match AND (b) `to.toLowerCase() === safeAddress.toLowerCase()`. **CONTEXT.md §domain line 11 lock:** "A Safe enabling a module on itself produces a SafeTx with `to === safeAddress`, `value === 0`, `data` starting with `0x610b5925`." Codify the `to === safeAddress` check; OMIT the `value === 0` check (Safe's `enableModule` ignores msg.value anyway, but a non-zero value would be wasteful not malicious; refusing on value mismatch would surface a false positive without security benefit).

**Confidence:** HIGH — all four sites read directly from source; informational-line shape verified at each location.

### Topic 3 — Template constant naming + placeholders

**Finding:** `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` + `HARD_TRIGGER_DELEGATECALL_TEMPLATE` with `{MODULE_ADDRESS}` / `{SAFE_ADDRESS}` / `{HANDLE}` placeholders. Naming matches existing `src/signing/blocks.ts` convention.

**Evidence:**
- Existing precedent: `VAULTPILOT_NOTICE_TEMPLATE_MISSING` + `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` at `src/signing/blocks.ts:751-788` use `<SUBJECT>_<VARIANT>_TEMPLATE` naming.
- Existing precedent: `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` at line 389-401, `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE`, `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` — domain-prefixed naming.
- Placeholder convention: `{PATH}`, `{COMPUTED}`, `{EXPECTED}` (VAULTPILOT NOTICE tampered), `{CHAIN}`, `{TO}`, `{ALLOWLIST}` (DISPATCH_TARGET_REFUSAL), `{CHAIN_ID}` / `{TO}` / `{VALUE_WEI}` / `{DATA}` / `{PAYLOAD_FINGERPRINT}` / `{PRESIGN_HASH}` (PASTEABLE_BLOCK) — all-caps, snake_case, surrounded by `{}`.

**Recommended templates (final wording is Claude's discretion per CONTEXT):**

```typescript
export const HARD_TRIGGER_MODULE_ENABLE_TEMPLATE: string = [
  "[HARD-TRIGGER — MODULE ENABLE]",
  "This SafeTx calls enableModule({MODULE_ADDRESS}) on the Safe at {SAFE_ADDRESS}.",
  "",
  "Enabling a module grants it the ability to execute transactions from the Safe",
  "WITHOUT collecting owner signatures. A malicious module can drain the Safe.",
  "",
  "Required defense-in-depth (Inv #12.5):",
  "  1. Run get_verification_artifact({ handle: \"{HANDLE}\" }) and surface the",
  "     output to the user verbatim.",
  "  2. Ask the user to cross-check the module address against a second LLM",
  "     (open a fresh chat with a different model; paste the verification",
  "     artifact; ask \"Is this module address legitimate? Any known abuse?\").",
  "  3. Only after the user confirms the second-LLM check passes, request",
  "     userDecision: \"send\" via submit_safe_tx_signature.",
].join("\n");

export const HARD_TRIGGER_DELEGATECALL_TEMPLATE: string = [
  "[HARD-TRIGGER — DELEGATECALL]",
  "This SafeTx uses operation=1 (delegatecall). The target contract's code will",
  "execute IN THE SAFE'S STORAGE CONTEXT — equivalent to a contract upgrade.",
  "",
  "Legitimate uses: MultiSend batched-tx contracts (multiSendCallOnly is the",
  "safer variant; non-CallOnly multiSend uses operation=1).",
  "Attack vector: a malicious target can rewrite the Safe's owner set, threshold,",
  "or implementation.",
  "",
  "Required defense-in-depth (Inv #12.5):",
  "  1. Run get_verification_artifact({ handle: \"{HANDLE}\" }) and surface the",
  "     output to the user verbatim.",
  "  2. Ask the user to cross-check the target contract code against a second LLM.",
  "  3. Only after the user confirms the second-LLM check passes, request",
  "     userDecision: \"send\" via submit_safe_tx_signature.",
].join("\n");
```

**Placeholder substitution map per emission site:**

| Site | `{HANDLE}` source | `{MODULE_ADDRESS}` source | `{SAFE_ADDRESS}` source |
|------|------|------|------|
| propose | `handle` (the UUID returned by `createHandle`) | `decodeEnableModuleCalldata(data).module` (lowercased; data is propose-input) | `rawSafeAddress` (the agent-supplied arg) |
| approve | `handle` (same UUID) | `decodeEnableModuleCalldata(data).module` (data fetched from Tx Service at line 248-251) | `rawSafeAddress` |
| execute (prepare) | `handle` (the new on-chain EVM handle) | `decodeEnableModuleCalldata(safeTxData).module` (`safeTxData` is the decoded inner data from `decodeSingleSafeExecTransaction(tx.data)` at line ~290) | `rawSafeAddress` |
| preview (execute re-emit) | `handleArg` (lookup arg) | `decodeEnableModuleCalldata(innerDecoded.data).module` (innerDecoded already computed at preview_send.ts:1895) | `record.tx.to` (the outer `tx.to` IS the Safe proxy at execute time — it's what `prepare_safe_tx_execute` sets `dispatchTarget` to at line 589) |

**Critical caveat about `{HANDLE}` at the `prepare_safe_tx_execute` site:** the execute path mints a `PreparedTxEvm` handle (NOT `PreparedTxSafeTypedData`). When the agent invokes `get_verification_artifact({ handle })` against this EVM handle, the tool reads `record.tx.to` (the Safe proxy), `record.tx.valueWei`, `record.tx.data` (the outer `execTransaction(...)` calldata) — which is what the second LLM should decode. This works correctly because `get_verification_artifact.ts:115-121` operates on EVM-shape sentinel fields, and the execute handle IS an EVM handle.

**For propose / approve (`PreparedTxSafeTypedData` handles):** `record.tx.to`, `record.tx.valueWei`, `record.tx.data` are SENTINEL fields (ZERO_ADDRESS, 0n, "0x") — the REAL SafeTx data lives in `safeTxTo`, `safeTxValue`, `safeTxData`. **This is a latent gap**: `get_verification_artifact` invoked on a Safe-typed-data handle returns sparse JSON with zero-valued sentinels, NOT the actual SafeTx the user should verify. The agent following the hard-trigger instruction will get a useless paste-able block.

> **OPEN ISSUE for Plan 38-01:** Resolve the `get_verification_artifact` vs Safe-typed-data handle gap. Three options:
> (a) **Extend `get_verification_artifact`** to special-case `record.tx.txType === "safe-typed-data"` and substitute the Safe-specific fields (`safeAddress`, `safeTxTo`, `safeTxValue`, `safeTxData`, `safeTxHash`, `payloadFingerprint`) into the pasteable block — would require a new template variant `PASTEABLE_BLOCK_TEMPLATE_SAFE` (mirror of existing `PASTEABLE_BLOCK_TEMPLATE` at line 811). Recommended.
> (b) **Document the limitation** in the hard-trigger block's prose ("for propose/approve handles, the verification artifact will be sparse; the agent must manually surface `safeTxData` from the prepare response"). Cheaper but worse UX.
> (c) **Skip the hard-trigger block on propose/approve handles** and only emit at execute time. Breaks defense-in-depth (the cross-signer scenario CONTEXT explicitly calls out).
>
> **Researcher reasonable-call: (a) is the right answer.** Plan 38-01 should add `PASTEABLE_BLOCK_TEMPLATE_SAFE` to `blocks.ts` and extend `get_verification_artifact.ts` to dispatch on `txType` at the existing handle-lookup site. This is a small extension (~30 lines) and makes the hard-trigger block's instruction operationally meaningful. **If executor disagrees, surface to user before planning gate.**

**Confidence:** HIGH on naming convention; MEDIUM on the `get_verification_artifact` gap resolution (depends on executor accepting option (a) at planning time).

### Topic 4 — Skill-integrity SHA-pin update — REPLACEMENT, not additive (DF-2 resolution)

**Finding:** `src/security/skill-integrity.ts:60-61` uses a SINGLE `EXPECTED_SKILL_SHA256` constant — NOT a list. Phase 38 REPLACES the v1.3.x pinned SHA with the v1.4 SHA. Adopting a multi-version list is out of scope.

**Evidence:**
```typescript
// src/security/skill-integrity.ts:60-61
export const EXPECTED_SKILL_SHA256 =
  "28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2";
```
The probe at lines 111-133 computes the SKILL.md SHA-256, compares against `EXPECTED_SKILL_SHA256` (strict equality), returns `kind: "ok" | "missing" | "tampered"`. There is no array iteration; the constant is a single hex string.

The `NOTICE` template `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` at `src/signing/blocks.ts:776-788` references "v1.3.0" verbatim (line 784: `(c) you have an older skill version than this MCP — git checkout v1.3.0`) — Phase 38 should update this prose to reference v1.4 instead.

The `INSTRUCTIONS` interpolation at `src/server.ts:52` also references "v1.3.0" verbatim — Phase 38 updates to v1.4.

**DF-2 resolution: REPLACE (not additive list).** Reasoning:
- The current code shape is a single constant. Promoting to a multi-version accept list is a behavioral change (a tampered SKILL.md that matches an OLD version's SHA would pass the check) — that's a security regression, not an upgrade.
- Phase 9 RESEARCH §Topic 3 established the SHA pin as a "single coordinated release" pattern; the SHA changes lockstep with each tagged release.
- Users on v1.3.x would receive a `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` block instructing them to `git checkout v1.4` — the NOTICE template's `(c)` self-diagnosis branch IS the multi-version handling. The notice surfaces the version-mismatch case loudly so users update.
- CONTEXT.md line 119 says "the integrity probe accepts either v1.3.x or v1.4 SHA (additive list, not replacement)" — but this is a CONTEXT-LEVEL DESIGN PROPOSAL by the discussion-phase author, not a verified description of the current code. **The code is single-constant**; the CONTEXT proposal is unimplemented. CONTEXT also says (Plan 38-01 spec line 119) "the integrity probe accepts either v1.3.x or v1.4 SHA (additive list, not replacement)" — this would require Phase 38 to ALSO ship the additive-list refactor, expanding scope.

> **Researcher reasonable-call:** Phase 38 ships REPLACEMENT (single-constant update from v1.3.x SHA to v1.4 SHA + prose updates in `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` and `src/server.ts` INSTRUCTIONS interpolation). The "additive list" promotion is a separate concern — defer to v2.5.x if user-pain data justifies. **If the user disagrees and wants the additive-list refactor in Phase 38, surface to user before planning gate.**

**Files modified for SHA update (Plan 38-01):**
- `src/security/skill-integrity.ts:60-61` — update `EXPECTED_SKILL_SHA256` constant to the v1.4 SHA.
- `src/server.ts:52` — update "v1.3.0" prose to "v1.4" in INSTRUCTIONS interpolation.
- `src/signing/blocks.ts:782-786` — update `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` prose to reference v1.4.
- `src/signing/blocks.ts:758-759` — update `VAULTPILOT_NOTICE_TEMPLATE_MISSING` install-instruction prose to reference v1.4 (line 759: `cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0` → `... git checkout v1.4`).

**SHA computation discipline (Plan 38-01 task):**
Same as Plan 09-02. Substitute v1.4 SHA into all four locations in a single atomic commit (template + MCP constant must move together — circular SHA otherwise per Plan 09-01 line 90 discipline). The v1.4 SHA is computed from the sister-repo SKILL.md content at Plan 38-02-bootstrap-time and committed in Plan 38-01.

**Confidence:** HIGH on current code shape (read directly); MEDIUM on the design fork (CONTEXT proposed additive list; researcher recommends REPLACE — surfaced as design fork DF-2).

### Topic 5 — Sister-repo coordination — Plan 09-01 → 09-02 precedent

**Finding:** Strict-sequential 38-01 → 38-02 mirrors Phase 9's 09-01 → 09-02 pattern. Carry forward the `gh` OAuth `workflow`-scope constraint as accepted residual.

**Evidence:**
- Phase 9 Plan 09-01 line 19-20: `vaultpilot-preflight-skill/.github/workflows/ci.yml # NEW SISTER REPO — CI runs test/sha256.sh on push`. Task 0 (`checkpoint:human-action`) gates the sister-repo creation; Task 1 ships the SKILL.md + ancillary files + CI workflow.
- Phase 9 Plan 09-01 line 89: "**No commits in the main worktree.** Operate exclusively in `.claude/worktrees/feat-09-01-sister-repo-vaultpilot-preflight-skill/` per the global recipe."
- Phase 9 Plan 09-01 line 425-426: "**Note on placeholder-state CI:** The initial `v1.3.0` push WILL have a failing CI (because README's `EXPECTED_SKILL_SHA256_PLACEHOLDER` text does NOT match the computed SHA…). This is INTENTIONAL — Plan 09-02 closes the loop…"
- The `gh OAuth workflow-scope` constraint: CONTEXT.md line 120 says "Sister repo CI workflow (`.github/workflows/ci.yml`) still deferred (Plan 09-01 W-1 carries forward; gh OAuth lacks `workflow` scope — same constraint at Plan 38-02)." This is a load-bearing carry-forward — the v1.3 release shipped without a CI workflow file (deferred at Plan 09-01 W-1); the v1.4 release will also ship without a CI workflow file. **Verify:** `gh auth status` would confirm scope.

**Sequencing (Plan 38-01 vs 38-02):**
1. **Plan 38-01 (main repo):** Author the v1.4 SKILL.md content locally (NEW file: e.g. `.planning/phases/38-safe-enable-module-delegate-call-second-llm/38-02-SKILL-TEMPLATE.md` mirroring Plan 09-01's `.planning/phases/09-.../09-01-SKILL-TEMPLATE.md`). Compute SHA-256 of that file. Substitute the SHA into `src/security/skill-integrity.ts` + `src/server.ts` + `src/signing/blocks.ts` prose lines. Atomic commit — template + MCP constant move together.
2. **Plan 38-02 (sister repo):** `cd /tmp && git clone https://github.com/szhygulin/vaultpilot-preflight-skill && cd vaultpilot-preflight-skill`. Copy SKILL.md verbatim from the main-repo `38-02-SKILL-TEMPLATE.md`. Update README.md "Expected SHA-256" section to match the new v1.4 SHA. Author CHANGELOG.md entry (v1.4 — Inv #12.5 HALT step). Commit + tag `v1.4` + push. CI workflow file deferred (same constraint as 09-01 W-1).

**Pattern: SHA pin lands in main repo BEFORE sister repo tag.** This is intentional — the SHA is computed from the LOCAL sister-repo content, not the remote tag. The remote tag is the user-facing release; the SHA pin tracks the content. Plan 38-02 just publishes the tag.

**No `gh repo create` checkpoint:** Plan 09-01 needed a user-checkpoint because it CREATED the sister repo. Plan 38-02 only TAGS an existing repo — no checkpoint needed.

**Confidence:** HIGH — sequencing read directly from Plan 09-01 + 09-02 plans (only 09-01 read in detail; 09-02 not opened but referenced via plan-folder listing).

### Topic 6 — Sister-repo `vaultpilot-preflight` SKILL.md current structure

**Finding:** The CANONICAL SKILL.md template lives at `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` in the main repo. The locally-installed copy at `~/.claude/skills/vaultpilot-preflight/SKILL.md` is from a DIFFERENT upstream (`vaultpilot-security-skill`) and SHOULD NOT be used as the insertion-point reference.

**Evidence:**
- `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` exists in main repo (verified via `Read` on lines 1-147). Structure:
  - YAML frontmatter (`name: vaultpilot-preflight`, `description`, `allowed-tools: Bash(sha256sum *) Bash(shasum *)`, `disable-model-invocation: false`).
  - Step 0 — Mandatory integrity self-check (sha256sum + EXPECTED_SKILL_SHA256 cross-check; emit `DO NOT SIGN.` on mismatch).
  - Step 1 — Inv #2.5: chain must be explicit.
  - Step 2 — Inv #1: outer dispatch-target allowlist.
  - Step 3 — Inv #2: payloadFingerprint re-derivation.
  - Step 4 — Inv #11: decoded action matches user-intent (includes `decode-unsupported` → `get_verification_artifact` fallback).
  - Step 5 — Inv #5: final on-device match.
  - Step 6 — Inv #14: revoke-flow completeness.

- Local install at `~/.claude/skills/vaultpilot-preflight/SKILL.md` (verified via `Read` on lines 1-100) ships from a different repo (`vaultpilot-security-skill`) with a different structure — pre-tool intent gate + fuzzy-address refusal logic. **THIS IS NOT THE CORRECT INSERTION REFERENCE.** Phase 38 must work against the planning-time template `09-01-SKILL-TEMPLATE.md`.

**Recommended Inv #12.5 insertion point:** Between Step 0 (self-check) and Step 1 (Inv #2.5 chain). New section heading: `## Step 0.5 — Inv #12.5: Safe high-blast-radius operation hard-trigger detection`.

**Rationale for placement:**
- Step 0 is the integrity self-check — must run FIRST. Inv #12.5 cannot precede it.
- Step 1 (Inv #2.5 chain explicit) checks an MCP-call ARGUMENT — runs BEFORE `prepare_*` invocation.
- Inv #12.5 checks an MCP RESPONSE block — runs AFTER `prepare_*` returns. So it shouldn't be Step 1, but it MUST run before Step 2 (Inv #1 dispatch-target — which reads the preview-side response). The natural location is between Step 1 and Step 2, OR as Step 0.5 (post-self-check, pre-arg-check).

**Researcher reasonable-call:** Insert as **Step 0.5** (decimal numbering follows the existing Inv #2.5 / Inv #6b / Inv #12.5 non-contiguous-numbering convention — Plan 09-01 line 36 explicitly notes "Numbering is NON-CONTIGUOUS — mirrors upstream `vaultpilot-mcp` scheme per RESEARCH § Topic 2 Pitfall — do NOT renumber"). Place it AFTER Step 0 self-check (which must run first), BEFORE Step 1 chain-explicit (which gates the prepare call). The Inv #12.5 check is a RESPONSE-LEVEL check; placing it as Step 0.5 establishes "after self-check, before invariant-by-invariant traversal".

**Recommended Inv #12.5 step text (final wording is Plan 38-02 executor's discretion):**

```markdown
## Step 0.5 — Inv #12.5: Safe high-blast-radius operation hard-trigger detection

After ANY MCP response that includes a `prepare_safe_tx_*` or `preview_send`
output (whether the user explicitly asked for a Safe operation or not):

1. Scan the response `content[0].text` for the literal block titles:
   - `[HARD-TRIGGER — MODULE ENABLE]`
   - `[HARD-TRIGGER — DELEGATECALL]`

2. If EITHER title appears, HALT the signing flow and require ALL THREE
   conditions before assisting with `submit_safe_tx_signature({ userDecision:
   "send" })` OR `send_transaction` against this handle:
   - (a) You have called `get_verification_artifact({ handle })` for the
     current handle, AND
   - (b) You have surfaced the verification artifact's `pasteableBlock`
     to the user VERBATIM (preserve the `>>>>` / `<<<<` markers), AND
   - (c) The user has explicitly confirmed the second-LLM cross-check
     passes ("the second LLM agrees the module/target is legitimate").

3. Until all three conditions are met, emit verbatim:
   `DO NOT SIGN. — Inv #12.5 second-LLM check incomplete (Safe high-blast-radius operation).`
   and refuse to relay the user's "send" intent.

4. If BOTH titles appear (composite enableModule + delegatecall), require
   the second-LLM check to address BOTH risks distinctly. Surface both
   blocks to the user; do not collapse.

This Inv runs in PARALLEL with the existing skill invariants — it gates
ONLY the `submit_safe_tx_signature` / `send_transaction` step for Safe
flows that emit a hard-trigger block. Non-Safe flows are unaffected.
The MCP-side hard-trigger block is the trigger signal; this skill-side
HALT condition is the load-bearing enforcement.
```

**Confidence:** HIGH on the template-vs-local-install discrepancy (both read directly); HIGH on the recommended insertion point (decimal-numbering convention matches existing Inv #2.5 + Inv #6b precedent).

### Topic 7 — SECURITY.md structure for Inv #12.5 codification + v2.5 close-out

**Finding:** SECURITY.md does NOT currently have a §6 "Safe" section. Phase 36 + Phase 37 did NOT add Safe-specific sections to SECURITY.md (verified by exhaustive `grep -n "^### \|^## "` listing). Phase 38 should ADD a new top-level section `## Phase 38 — `enableModule` + delegatecall hard-trigger (Inv #12.5)` that ALSO serves as the v2.5 milestone close-out summary (referencing Phase 36 + Phase 37 + Phase 38 collectively).

**Evidence:**
- `SECURITY.md` ends at line 572 with the Phase 32 close-out. The most recent section (Phase 32, v2.4) follows the milestone-close-out shape:
  - `## Phase 32 — Uniswap V3 swap (v2.4)` heading (line 544).
  - Four narrative paragraphs documenting design tradeoffs.
  - `### Phase 32 threat register summary` table.
  - Closing paragraph naming the verify-phase requirement.
- CONTEXT.md line 17 says "**v2.5 milestone close-out** — Phase 38 finalizes the Safe-specific section in SECURITY.md (Inv #12.5 codification + blast-radius rationale + Ledger typed-data CAL coverage gap accepted-residual notes from Phase 37)." Phase 37 did NOT itself add a SECURITY.md section (Phase 37 SUMMARY pending verification; not opened — but `grep` returns no Phase-37-specific section heading).

**`Inv #` numbering precedent:**
- Plan 09-01 SKILL-TEMPLATE uses Inv #1, #2, #2.5, #5, #11, #14 (non-contiguous).
- REQUIREMENTS.md references Inv #6b at SOL-W-21 / TRON-W-11 / BTC-LIFI-01 / BRIDGE-T1 (decoded-recipient assertion at preview).
- CONTEXT.md (line 105) says "Format mirrors Inv #6b (decoded-recipient assertion at preview)" — Inv #6b is in REQUIREMENTS, but a quick search shows it's NOT currently codified in SECURITY.md (it's still pending Phase 39 BRIDGE-T1).
- Inv #12.5 follows the decimal-numbering convention (parallel to Inv #2.5).

**Recommended Inv #12.5 entry in SECURITY.md:** New section after Phase 32 closure (line 573). Heading: `## Phase 38 — `enableModule` + delegatecall hard-trigger second-LLM check (Inv #12.5) + v2.5 close-out`. Structure:

```markdown
## Phase 38 — `enableModule` + delegatecall hard-trigger second-LLM check (Inv #12.5) + v2.5 close-out

Phase 38 promotes two pre-staged informational warnings (Phase 37 `delegatecall: YES` informational lines at `prepare_safe_tx_propose` / `_approve` / `_execute`, and Phase 36 `enabledModules[]` surfacing in `get_safe_positions`) into hard-trigger blocks that gate user confirmation on a second-LLM cross-check (`get_verification_artifact` from v1.3 Plan 09-03). **Inv #12.5 codifies this defense layer**.

### Inv #12.5 — High-blast-radius Safe operations require second-LLM cross-check before signing

**Trigger conditions** (either or both — composite emits both blocks in document order: MODULE ENABLE first, DELEGATECALL second):
- **`enableModule(address)` selector match** — inner SafeTx `data` field starts with `0x610b5925` AND `to === safeAddress` (a Safe enabling a module on itself). A SafeTx enabling a malicious module is equivalent to draining the Safe — modules call `execTransactionFromModule` and bypass owner-approval entirely.
- **`operation === "delegatecall"` discriminator match** — SafeTx-level `operation` field is the `delegatecall` enum (numeric 1; semantic string "delegatecall" per `PreparedTxSafeTypedData.operation`). `delegatecall` executes target code in the Safe's storage context — equivalent to a contract upgrade. Used legitimately by `multiSend` (non-CallOnly); also a common upgrade-attack vector.

**Emission sites** (MCP-side):
- `prepare_safe_tx_propose` — detects both conditions on agent-supplied SafeTx args.
- `prepare_safe_tx_approve` — detects both conditions on Tx-Service-fetched SafeTx record (co-sign path).
- `prepare_safe_tx_execute` — detects both conditions on inner-decoded `execTransaction` calldata (the SafeTx encapsulated in the outer execTransaction call).
- `preview_send` — re-emits at the EVM dispatch site IFF `record.isSafeExecTransaction === true`; defense-in-depth for the cross-signer scenario where the executor's MCP session lacks the propose-side state.

**Block templates** (APPEND-ONLY in `src/signing/blocks.ts`):
- `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` — substitutes `{MODULE_ADDRESS}` / `{SAFE_ADDRESS}` / `{HANDLE}`.
- `HARD_TRIGGER_DELEGATECALL_TEMPLATE` — substitutes `{SAFE_ADDRESS}` / `{HANDLE}` (no module address; the target lives in the calldata which the second LLM decodes).

**Skill-side enforcement** (load-bearing defense, `vaultpilot-preflight` v1.4 Step 0.5):
A skill installation at v1.4+ encodes Inv #12.5 as a HALT condition: agent MUST call `get_verification_artifact({ handle })`, surface the output verbatim to the user, AND obtain user confirmation of the second-LLM check before assisting with `submit_safe_tx_signature({ userDecision: "send" })` or `send_transaction`. The skill block-title scan keys on the literal strings `[HARD-TRIGGER — MODULE ENABLE]` and `[HARD-TRIGGER — DELEGATECALL]` — drift in either MCP-side block title or skill-side scan pattern breaks the enforcement coupling.

**Accepted residual** (T-INV-12.5-NON-SKILL-1, MEDIUM, documented):
A non-skill-using agent can ignore the hard-trigger block. The MCP cannot enforce — the block is an instruction TO the agent, not a server-side gate. **The skill-side enforcement is the load-bearing defense; the MCP-side block is the trigger signal.** Users without `vaultpilot-preflight` installed receive the `VAULTPILOT NOTICE — skill not installed` block on every fresh session (Plan 09-02 dispatcher-wrap) — surfacing the gap so the user knows defense-in-depth is reduced to MCP-side checks only. The trust anchor remains the Ledger device screen.

### Ledger typed-data CAL coverage gap (Phase 37 accepted residual — cross-link)

Phase 37 ships off-chain EIP-712 typed-data signing for Safe propose / approve flows. The Ledger ETH app's clear-sign coverage for Safe typed-data depends on per-firmware CAL/EIP-712 filter files. When coverage is missing (typical for Safe v1.3.0 / v1.4.1 contracts as of the v2.5 ship cadence), the device displays the 32-byte EIP-712 digest only ("Sign Hash: 0x…") — blind-sign mode. Phase 37 surfaces the digest in the `LEDGER DISPLAY` block alongside both possible displays so the agent can relay both to the user. **Phase 38 does NOT add a new accepted residual — the hard-trigger block IS the defense.** The user's defense-in-depth path for blind-signed Safe typed-data is: (a) MCP-side hard-trigger block emission, (b) skill-side Inv #12.5 HALT condition, (c) second-LLM out-of-band decode via `get_verification_artifact`, (d) on-device 32-byte digest visual match.

### v2.5 milestone close-out summary

The v2.5 Safe milestone (Phases 36 + 37 + 38) is code-complete. Trust-pipeline shape:
- **Phase 36 (read-only foundation):** Safe Tx Service client + Singleton SOT + canonical-dispatch Safe arm + `get_safe_positions` + `get_safe_transaction`. Trust shape: read-only with on-chain cross-check; no signing surface.
- **Phase 37 (three-step signing flow):** `prepare_safe_tx_propose` + `prepare_safe_tx_approve` + `submit_safe_tx_signature` + `prepare_safe_tx_execute`. New `PreparedTxSafeTypedData` discriminant + `VaultPilot-safetx-v1:` payloadFingerprint domain tag + EIP-712 typed-data signing transport via `eth_signTypedData_v4` over WalletConnect. Trust shape: typed-data sign on Ledger (clear-sign if CAL covers; blind-sign with digest match otherwise) + ECDSA-recover + Tx Service signature post + threshold-collect + execTransaction dispatch via Singleton (Layer 0.5 bypass via `isSafeExecTransaction` sentinel, server-verified by 5 prepare-time invariants).
- **Phase 38 (hard-trigger second-LLM check):** Inv #12.5 as documented above. Final v2.5 close-out.

The v2.5 verify-phase remains pending a real-Ledger smoke against Ethereum mainnet — small-balance 1-of-1 Safe propose → submit → execute, with the agent traversing the hard-trigger block + invoking `get_verification_artifact` + the user performing the second-LLM ritual end-to-end on a legitimate (non-malicious) `enableModule` call to exercise the full path without actually enabling a hostile module (verification can be performed on testnet with a sentinel "no-op" module, e.g. a contract that exposes `execTransactionFromModule` but never calls it).

### Phase 38 threat register summary

| Threat ID | STRIDE | Severity | Disposition | Mitigation |
|-----------|--------|----------|-------------|------------|
| T-INV-12.5-NON-SKILL-1 | Information Disclosure | MEDIUM | accept (documented) | Skill-side enforcement is load-bearing; non-skill-using agents receive `VAULTPILOT NOTICE — skill not installed`. Trust anchor remains Ledger device screen. |
| T-MODULE-ENABLE-MALICIOUS-1 | Elevation of Privilege | HIGH | mitigate | MCP-side hard-trigger block emission + skill-side Inv #12.5 HALT + second-LLM out-of-band decode via `get_verification_artifact`. Server cannot enforce client-side ritual; defense-in-depth across three layers. |
| T-DELEGATECALL-UPGRADE-ATTACK-1 | Elevation of Privilege | HIGH | mitigate | Same as T-MODULE-ENABLE-MALICIOUS-1; `delegatecall` discriminator catches `changeMasterCopy`-style proxy upgrade attacks by construction. |
| T-COMPOSITE-EMISSION-DRIFT-1 | Tampering | MEDIUM | mitigate | Skill keys on block titles INDEPENDENTLY; composite emission of both blocks is asserted in `test/hard-trigger-emission.test.ts` (drift in either title or the composite-order assertion fails the test). |
| T-FROZEN-SIGNING-38 | Tampering | CRITICAL | mitigate | Zero-diff invariant on `src/signing/payload-fingerprint.ts` / `src/signing/handle-store.ts` state machine / `src/tools/send_transaction.ts` three gates / Phase 37 fixtures (SAFE-A/B/C/D) asserted by `git diff --stat origin/main` returning empty across Plan 38-01. |
| T-SKILL-V14-COORDINATION-1 | Tampering | MEDIUM | mitigate | Plan 38-01 commits SHA pin BEFORE Plan 38-02 tags the release (mirror of Plan 09-01 → 09-02 sequencing). Template-vs-sister-repo byte-identity asserted at Plan 38-02 execute-time `sha256sum` cross-check. |
```

**Confidence:** HIGH — SECURITY.md structure read directly; Inv #12.5 placement is researcher reasonable-call (the file has no §6 Safe section per current contents; CONTEXT.md said "§6" but that's anachronistic — Phase 38 creates the new section).

### Topic 8 — Test-file split decision

**Finding:** Mixed approach — NEW `test/protocols-safe.test.ts` for the selector + decoder (mirrors `test/signing-safe-exec-decode.test.ts` shape — already exists at 159 lines for execTransaction decode), PLUS extend existing `test/prepare-safe-tx-propose.test.ts` (391 lines) / `test/prepare-safe-tx-approve.test.ts` (474 lines) / `test/prepare-safe-tx-execute.test.ts` (657 lines) / `test/preview-send.safe-execute.test.ts` (340 lines) with new block-emission assertions. Do NOT create a single mega-test `test/hard-trigger-emission.test.ts` — the per-tool block-emission tests anchor against the specific tool's response shape, and the cross-tool composition tests live in integration.

**Evidence:**
- Existing pattern: per-tool tests live in `test/<tool-name>.test.ts`. Cross-tool integration tests live in `test/integration/`.
- Existing `test/signing-safe-exec-decode.test.ts` (159 lines) anchors the inner-decode selector + ABI round-trip — `test/protocols-safe.test.ts` would be its sibling (selector match + decoder for `enableModule`).
- Each Phase 37 prepare/preview test already imports the corresponding tool + asserts on response `text` substring matches — extending those tests to also assert `text.includes("[HARD-TRIGGER — MODULE ENABLE]")` is a one-line addition per scenario.

**Recommended test file map:**

| Test File | Status | New Tests (estimate) | Coverage |
|-----------|--------|---------------------|----------|
| `test/protocols-safe.test.ts` | NEW | 6-8 unit | Fixture SAFE-G selector-prefix match + argument decode round-trip + lowercase normalization + negative cases (non-enableModule calldata; truncated calldata throw) |
| `test/prepare-safe-tx-propose.test.ts` | EXTEND | 4-5 tests | enableModule detection emits MODULE ENABLE block; delegatecall emits DELEGATECALL block; composite (both) emits BOTH in correct order; non-trigger SafeTx emits NEITHER; informational `delegatecall: YES` line REMOVED from CHECKS PERFORMED |
| `test/prepare-safe-tx-approve.test.ts` | EXTEND | 4-5 tests | Same scenarios as propose, but data fetched from stubbed Tx Service |
| `test/prepare-safe-tx-execute.test.ts` | EXTEND | 4-5 tests | Inner-decoded enableModule emits MODULE ENABLE block; outer-execTransaction's `delegatecall` operation emits DELEGATECALL block; composite handling |
| `test/preview-send.safe-execute.test.ts` | EXTEND | 3-4 tests | Inner-decoded enableModule re-emits MODULE ENABLE block; delegatecall re-emits; composite-tx preview block + hard-trigger blocks coexist (anchor join-order) |
| `test/security-skill-integrity.test.ts` | EXTEND | 2 tests | v1.4 SHA pin matches; `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` prose references v1.4 (NOT v1.3.0) |
| `test/signing-blocks.test.ts` (if exists) OR new `test/signing-blocks-hard-trigger.test.ts` | EXTEND/NEW | 4 tests | `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` substitution shape; `HARD_TRIGGER_DELEGATECALL_TEMPLATE` substitution shape; placeholder coverage (all `{*}` slots filled); byte-stable template literal (anchor against drift) |

**Total estimate:** ~27-32 new tests across 7 files (1 NEW + 5 EXTEND + 1 NEW-or-EXTEND). Comparable scale to Phase 37's per-plan test deltas (37-01 = +42 unique tests).

**Reject merging into one file:** A single `test/hard-trigger-emission.test.ts` would re-import all four tools + their mock dependencies (Tx Service stub, on-chain stub, handle-store reset, etc.) — duplicating the harness from each per-tool test. Per-tool tests already have the harness; adding a few assertions is cheaper.

**Confidence:** HIGH — test-file convention read directly from `ls test/`.

### Topic 9 — Fixture SAFE-G calldata anchor

**Finding:** Fixture SAFE-G is the hardcoded `enableModule(address)` calldata literal in `test/protocols-safe.test.ts`. Computed via viem at research time for the canonical SOT.

**Concrete fixture value (computed via viem 2.48.11):**

```typescript
// test/protocols-safe.test.ts — Fixture SAFE-G
//
// Hardcoded `enableModule(0xcafe0000000000000000000000000000cafe0001)` calldata
// — selector + 32-byte padded address argument. Pins:
//   1. ENABLE_MODULE_SELECTOR === "0x610b5925" (matches viem.toFunctionSelector)
//   2. decodeEnableModuleCalldata round-trip: data → { module } → re-encode === data
//   3. isEnableModuleCalldata positive case: data.slice(0,10).toLowerCase() === "0x610b5925"
//
// CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" —
// while this is NOT a fingerprint shape (no new cryptographic binding), the
// selector + decoder regression follows the same NO `beforeAll`-snapshot
// discipline. The literal is the SOT; drift in `viem.encodeFunctionData` is
// caught here at the specific line, not against a self-snapshotted value.
export const FIXTURE_SAFE_G_CALLDATA =
  "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001" as const;

export const FIXTURE_SAFE_G_MODULE_ADDRESS =
  "0xcafe0000000000000000000000000000cafe0001" as const; // lowercased — bypasses EIP-55 checksum (per Phase 37 Fixture SAFE-B Rule 1 — Bug deviation pattern)

export const FIXTURE_SAFE_G_DECODED_CHECKSUM_MODULE =
  "0xcafe0000000000000000000000000000caFe0001" as const; // viem.decodeFunctionData returns EIP-55 checksum'd address — anchor the post-decode form too
```

**Why a lowercased address (not EIP-55 checksum):** Phase 37 ships Fixture SAFE-B with a lowercased Safe address (per CONTEXT.md project skills observation: "One `[Rule 1 - Bug]` deviation: lowercased Fixture SAFE-B safeAddress to bypass viem EIP-55 checksum validation."). The same applies here — `viem.encodeFunctionData` with a checksum'd address argument may throw `InvalidAddressError` on EIP-55 mismatch. Lowercase the input; trust viem's downstream `decodeFunctionData` to return EIP-55 checksum'd form. Anchor both forms in the fixture for the round-trip test.

**Negative-case fixtures (also in `test/protocols-safe.test.ts`):**
```typescript
// Non-enableModule calldata — should NOT match isEnableModuleCalldata
export const FIXTURE_SAFE_G_NEGATIVE_RANDOM = "0x12345678abcdef" as const;
// Truncated enableModule calldata — selector matches but argument is short; decodeFunctionData should throw
export const FIXTURE_SAFE_G_NEGATIVE_TRUNCATED = "0x610b5925cafe" as const;
```

**Confidence:** HIGH — literal computed via viem 2.48.11 at research time; matches CONTEXT lock shape line 91-94.

### Topic 10 — Ledger CAL coverage for `enableModule` clear-sign

**Finding:** Phase 38 does NOT add a new accepted residual. The hard-trigger block IS the defense. Reuse the Phase 37 typed-data CAL-coverage-gap framing.

**Evidence:**
- CONTEXT.md line 17: "**v2.5 milestone close-out** — Phase 38 finalizes the Safe-specific section in SECURITY.md (Inv #12.5 codification + blast-radius rationale + **Ledger typed-data CAL coverage gap accepted-residual notes from Phase 37**)."
- The Phase 37 typed-data CAL-coverage-gap residual is documented in `src/tools/prepare_safe_tx_propose.ts:547-559` (the `LEDGER DISPLAY` block surfaces BOTH clear-sign + blind-sign expectations); Phase 37 SUMMARY (not opened, but `STATE.md` summary line 35 confirms): "surfaces PREPARE RECEIPT + CHECKS PERFORMED with domainSeparator drift detection + LEDGER DISPLAY with both clear-sign + blind-sign expectations".
- Phase 37 RESEARCH § Pitfall (from RESEARCH.md, not fully read but referenced at line 855-857 of the topic-by-topic findings): "Blind-sign mode on Ledger (no clear-sign coverage; user signs unparseable hash) — Mitigated by user attention; `LEDGER BLIND-SIGN HASH` block matches the safeTxHash; user visually confirms on-device — accepted residual (documented in SECURITY.md)".

**Phase 38's framing:**
- The Ledger CAL gap is a PHASE 37 RESIDUAL, not a Phase 38 RESIDUAL.
- Phase 38 references this residual in the SECURITY.md section (cross-link, see Topic 7 above), naming it as the reason the hard-trigger + second-LLM defense matters.
- The user's defense-in-depth path for blind-signed Safe typed-data is: (a) MCP-side hard-trigger block emission, (b) skill-side Inv #12.5 HALT condition, (c) second-LLM out-of-band decode via `get_verification_artifact`, (d) on-device 32-byte digest visual match.

**Recommended SECURITY.md prose for this framing:** See § Topic 7 above, "### Ledger typed-data CAL coverage gap (Phase 37 accepted residual — cross-link)" sub-section.

**Confidence:** HIGH — Phase 37 SUMMARY pointed at via STATE.md; CONTEXT.md explicit on the cross-link discipline.

## Design Fork Resolutions

### DF-1 — Replace informational `delegatecall: YES` lines vs add-alongside hard-trigger block

**Resolution: REPLACE (pre-locked at planning gate).**

**Rationale:**
- The Phase 37 informational line explicitly says "Phase 38 will hard-trigger second-LLM check here (informational at Phase 37)". Phase 38 IS the promotion site.
- Keeping the line alongside the hard-trigger block creates redundant prose in the same response. Cleaner UX: one block per concern.
- The CHECKS PERFORMED block is a STATIC list of verified facts; the hard-trigger block is a SEPARATE call-to-action. Mixing semantic categories degrades the response surface.
- The replaced line was tagged "informational at Phase 37" → it's a known-temporary placeholder; replacing it is the contract.

**Operational impact:** The line is REMOVED from `checksPerformed` array in all three tools (propose / approve / execute). The hard-trigger block is appended to the `text` join as a NEW block. Net response-shape change at each tool: one short line goes away from CHECKS PERFORMED; one full multi-line block appears after LEDGER DISPLAY.

### DF-2 — SHA-pin list shape: ADDITIVE vs REPLACEMENT

**Resolution: REPLACEMENT (pre-locked at planning gate, with caveat).**

**Rationale:**
- Current code is a SINGLE constant (`src/security/skill-integrity.ts:60-61`). Adopting an additive list is a behavioral change, not an extension.
- An additive list would allow a tampered SKILL.md matching an OLD version's SHA to pass the integrity check — that's a security regression.
- Phase 9 RESEARCH established single-coordinated-release discipline; v1.3 → v1.4 is one such coordinated release. The user-update path is: see `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED`, follow the "(c) older skill version" prose, `git checkout v1.4`.
- CONTEXT.md line 119 proposes "additive list" — this is unimplemented in the current code; promoting to an additive list is a separate refactor.

**Caveat:** If the user explicitly wants the additive-list refactor in Phase 38, surface it at the planning gate. Implementation cost: ~30 lines (change `EXPECTED_SKILL_SHA256: string` to `ALLOWED_SKILL_SHA256: readonly string[]`, update `checkSkillIntegrity` to iterate, update `consumeSkillIntegrityNotice` to surface which SHA matched). Test-cost: +5-10 tests. Not free, but small.

## Implementation Sketches

### `src/protocols/safe.ts` (NEW, ~70 lines)

```typescript
// Per-protocol decoder for Safe — Phase 38 (SAFE-09).
//
// Mirror of `src/protocols/erc20.ts` / `src/protocols/aave-v3.ts` shape:
// selector constant + decoder function + predicate helper. Pure functions;
// no I/O. Consumed by `src/tools/prepare_safe_tx_propose.ts`,
// `src/tools/prepare_safe_tx_approve.ts`, `src/tools/prepare_safe_tx_execute.ts`,
// and `src/tools/preview_send.ts`'s Safe-execute composite-tx branch.
//
// Anchored by Fixture SAFE-G in `test/protocols-safe.test.ts` —
// the selector + decoder round-trip is the regression contract.

import { decodeFunctionData, parseAbi, type Address, type Hex } from "viem";

/**
 * Canonical Safe `enableModule(address)` selector.
 *
 * `viem.toFunctionSelector('enableModule(address)')` returns `0x610b5925`.
 * Verified at research time against installed viem 2.48.11. Identical across
 * Safe v1.3.0 and v1.4.1 (single `address` parameter; no overloads).
 *
 * Phase 38 hard-trigger detection. A SafeTx with `data.slice(0, 10) ===
 * ENABLE_MODULE_SELECTOR` AND `to === safeAddress` (a Safe enabling a module
 * on itself) emits the `[HARD-TRIGGER — MODULE ENABLE]` block — enabling
 * a malicious module is equivalent to draining the Safe.
 */
export const ENABLE_MODULE_SELECTOR = "0x610b5925" as const;

const enableModuleAbi = parseAbi(["function enableModule(address module)"]);

/**
 * Selector-prefix predicate. Lowercase-normalized so mixed-case calldata
 * (e.g. Tx Service hex with EIP-55 inputs) matches uniformly.
 */
export function isEnableModuleCalldata(data: Hex): boolean {
  return data.length >= 10 && data.slice(0, 10).toLowerCase() === ENABLE_MODULE_SELECTOR;
}

/**
 * Decode `enableModule(address)` calldata. Throws on:
 *   - selector mismatch (caller should pre-check via `isEnableModuleCalldata`)
 *   - viem-internal decode failure (truncated calldata)
 *
 * Returns the single `module: Address` argument (EIP-55 checksum'd per viem
 * convention).
 */
export function decodeEnableModuleCalldata(data: Hex): { module: Address } {
  const decoded = decodeFunctionData({ abi: enableModuleAbi, data });
  if (decoded.functionName !== "enableModule") {
    throw new Error(
      `decodeEnableModuleCalldata: expected functionName 'enableModule', got '${decoded.functionName}'`,
    );
  }
  const args = decoded.args as readonly [Address];
  return { module: args[0] };
}
```

### `src/signing/blocks.ts` (EXTEND, +35 lines at end of file)

```typescript
// -----------------------------------------------------------------------------
// Phase 38 Plan 38-01 — Hard-trigger blocks for high-blast-radius Safe operations
// (Inv #12.5). APPEND-ONLY templates; consumed by:
//   - src/tools/prepare_safe_tx_propose.ts (enableModule on inner data; delegatecall on operation)
//   - src/tools/prepare_safe_tx_approve.ts (same; data fetched from Tx Service)
//   - src/tools/prepare_safe_tx_execute.ts (enableModule on inner-decoded safeTxData; delegatecall on inner operation)
//   - src/tools/preview_send.ts (re-emission inside the Phase 37 safe-execute branch when isSafeExecTransaction === true)
//
// Substitution at emission site. Format-fanout-sentinel: one block, one home.
// Drift in either title or placeholder coverage breaks the skill-side scan
// pattern (vaultpilot-preflight v1.4 Step 0.5 keys on the literal titles).
// -----------------------------------------------------------------------------

export const HARD_TRIGGER_MODULE_ENABLE_TEMPLATE: string = [
  "[HARD-TRIGGER — MODULE ENABLE]",
  "This SafeTx calls enableModule({MODULE_ADDRESS}) on the Safe at {SAFE_ADDRESS}.",
  "",
  "Enabling a module grants it the ability to execute transactions from the Safe",
  "WITHOUT collecting owner signatures. A malicious module can drain the Safe.",
  "",
  "Required defense-in-depth (Inv #12.5):",
  "  1. Run get_verification_artifact({ handle: \"{HANDLE}\" }) and surface the",
  "     output to the user verbatim.",
  "  2. Ask the user to cross-check the module address against a second LLM",
  "     (open a fresh chat with a different model; paste the verification",
  "     artifact; ask \"Is this module address legitimate? Any known abuse?\").",
  "  3. Only after the user confirms the second-LLM check passes, request",
  "     userDecision: \"send\" via submit_safe_tx_signature.",
].join("\n");

export const HARD_TRIGGER_DELEGATECALL_TEMPLATE: string = [
  "[HARD-TRIGGER — DELEGATECALL]",
  "This SafeTx uses operation=1 (delegatecall) on the Safe at {SAFE_ADDRESS}. The target",
  "contract's code will execute IN THE SAFE'S STORAGE CONTEXT — equivalent to a contract upgrade.",
  "",
  "Legitimate uses: MultiSend batched-tx contracts (multiSendCallOnly is the",
  "safer variant; non-CallOnly multiSend uses operation=1).",
  "Attack vector: a malicious target can rewrite the Safe's owner set, threshold,",
  "or implementation.",
  "",
  "Required defense-in-depth (Inv #12.5):",
  "  1. Run get_verification_artifact({ handle: \"{HANDLE}\" }) and surface the",
  "     output to the user verbatim.",
  "  2. Ask the user to cross-check the target contract code against a second LLM.",
  "  3. Only after the user confirms the second-LLM check passes, request",
  "     userDecision: \"send\" via submit_safe_tx_signature.",
].join("\n");
```

### `src/tools/prepare_safe_tx_propose.ts` (EDIT — REMOVE line 537-539; ADD block emission after `ledgerDisplay`)

```typescript
// At line 537-539, REMOVE:
//   ...(operationStr === "delegatecall"
//     ? ["  delegatecall:     YES — Phase 38 will hard-trigger second-LLM check here (informational at Phase 37)"]
//     : []),

// At line ~560 (right before `const text = [prepareReceipt, checksPerformed, ledgerDisplay].join("\n\n");`):
// ADD hard-trigger block(s) composition logic:

const hardTriggerBlocks: string[] = [];

// MODULE ENABLE — enableModule on inner data AND to === safeAddress (Safe enabling module on itself).
if (isEnableModuleCalldata(data) && to.toLowerCase() === safeAddress.toLowerCase()) {
  let moduleAddress: Address;
  try {
    moduleAddress = decodeEnableModuleCalldata(data).module;
  } catch (err) {
    // Truncated calldata — surface as structured refusal per CONTEXT lock line 81.
    return {
      isError: true,
      content: [{ type: "text", text: `error: SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed` }],
      structuredContent: errEnvelope("INVALID_INPUT", "SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed"),
    };
  }
  hardTriggerBlocks.push(
    HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
      .replace("{MODULE_ADDRESS}", moduleAddress)
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

// DELEGATECALL — operation === "delegatecall".
if (operationStr === "delegatecall") {
  hardTriggerBlocks.push(
    HARD_TRIGGER_DELEGATECALL_TEMPLATE
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

// Update the text join to append hard-trigger blocks (composite emits both in document order: MODULE ENABLE first).
const text = [prepareReceipt, checksPerformed, ledgerDisplay, ...hardTriggerBlocks].join("\n\n");
```

**Same shape mirrors at `src/tools/prepare_safe_tx_approve.ts` (REMOVE line 409-413; ADD post-`ledgerDisplay`).**

### `src/tools/prepare_safe_tx_execute.ts` (EDIT — REMOVE line 538-542; ADD block emission)

The execute tool's text composition is more complex (WARN block precedes prepareReceipt at line 572-577). Recommended position: hard-trigger blocks AT THE END (after `ledgerNotice`) for visual prominence and consistency with propose/approve.

```typescript
// Variable scope: decodedInner is computed at line ~290 (decodeSingleSafeExecTransaction); safeTxTo, safeTxData are derived at lines 295-297.
// safeTxData is the INNER data field — what the Safe will pass when execTransaction runs. This is where enableModule selector match fires.
// operationStr is the inner operation discriminator at line 293-294.

const hardTriggerBlocks: string[] = [];

if (isEnableModuleCalldata(safeTxData) && safeTxTo.toLowerCase() === safeAddress.toLowerCase()) {
  let moduleAddress: Address;
  try {
    moduleAddress = decodeEnableModuleCalldata(safeTxData).module;
  } catch (err) {
    // Truncated inner-calldata path
    return errResponse;
  }
  hardTriggerBlocks.push(
    HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
      .replace("{MODULE_ADDRESS}", moduleAddress)
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

if (operationStr === "delegatecall") {
  hardTriggerBlocks.push(
    HARD_TRIGGER_DELEGATECALL_TEMPLATE
      .replace("{SAFE_ADDRESS}", rawSafeAddress)
      .replace("{HANDLE}", handle),
  );
}

// REMOVE existing line 538-542 informational delegatecall:YES from `checksPerformed`.
// Update text join at line 572-577:
const text = [
  warnBlock,
  prepareReceipt,
  checksPerformed,
  ledgerNotice,
  ...hardTriggerBlocks,
].join("\n\n");
```

### `src/tools/preview_send.ts` (EDIT — extend the Phase 37 safe-execute branch at lines 1873-1968 with re-emission)

```typescript
// Inside the existing `if (record.tx.data !== "0x" && record.tx.data.slice(0, 10) === EXEC_TRANSACTION_SELECTOR) { ... }` arm at line 1890:
// AFTER `safeExecDecodeBlock` and `safeExecWarnBlock` are built (i.e. after line 1961),
// ADD:

let safeHardTriggerBlocks: string[] = [];

if (innerDecoded) { // innerDecoded already defined at line 1895
  if (isEnableModuleCalldata(innerDecoded.data) && innerDecoded.to.toLowerCase() === (record.tx.to as string).toLowerCase()) {
    try {
      const { module } = decodeEnableModuleCalldata(innerDecoded.data);
      safeHardTriggerBlocks.push(
        HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
          .replace("{MODULE_ADDRESS}", module)
          .replace("{SAFE_ADDRESS}", record.tx.to as string)
          .replace("{HANDLE}", handleArg),
      );
    } catch {
      // Truncated inner-calldata: silently skip the block re-emission at preview (the prepare-side already refused).
    }
  }
  if (innerDecoded.operation === 1) {
    safeHardTriggerBlocks.push(
      HARD_TRIGGER_DELEGATECALL_TEMPLATE
        .replace("{SAFE_ADDRESS}", record.tx.to as string)
        .replace("{HANDLE}", handleArg),
    );
  }
}

// Then APPEND `safeHardTriggerBlocks` to the response text join at the appropriate site
// (find where `safeExecDecodeBlock` + `safeExecWarnBlock` are joined into the final text).
```

### `src/security/skill-integrity.ts` (EDIT — line 60-61, SHA pin update)

```typescript
// REPLACE line 60-61:
export const EXPECTED_SKILL_SHA256 =
  "<v1.4 SHA computed from sister-repo SKILL.md content at Plan 38-02-bootstrap-time>";
```

Plus update prose references in:
- `src/server.ts:52` — "v1.3.0" → "v1.4"
- `src/signing/blocks.ts:758-759` — install instructions
- `src/signing/blocks.ts:782-786` — VAULTPILOT_NOTICE_TEMPLATE_TAMPERED prose

## Architecture Patterns

### System Architecture Diagram (Phase 38 dataflow)

```
agent (Claude Code) ────────────────────────────────────────────
   │
   │  STEP 1 — propose / approve / execute (Phase 37 surface)
   │  prepare_safe_tx_propose / _approve / _execute
   ▼
src/tools/prepare_safe_tx_propose.ts (and siblings)
   │
   ├── (existing Phase 37 plumbing — on-chain reads + EIP-712 typed-data digest + handle mint)
   │
   ├── NEW PHASE 38 GATE — selector match + operation discriminator:
   │      ├── if isEnableModuleCalldata(data) && to === safeAddress:
   │      │      emit HARD_TRIGGER_MODULE_ENABLE_TEMPLATE
   │      │      substitute {MODULE_ADDRESS} (from decoder) / {SAFE_ADDRESS} / {HANDLE}
   │      │
   │      └── if operationStr === "delegatecall":
   │             emit HARD_TRIGGER_DELEGATECALL_TEMPLATE
   │             substitute {SAFE_ADDRESS} / {HANDLE}
   │
   └── return { content: [{ text: [prepareReceipt, checksPerformed, ledgerDisplay, ...hardTriggerBlocks].join("\n\n") }] }
                  │
                  │  agent sees hard-trigger block in response.content[0].text
                  ▼
   vaultpilot-preflight v1.4 Step 0.5 (skill-side enforcement)
   ├── scan response.content[0].text for "[HARD-TRIGGER — MODULE ENABLE]" or "[HARD-TRIGGER — DELEGATECALL]"
   ├── if found, HALT and require:
   │      (a) agent calls get_verification_artifact({ handle })
   │      (b) agent surfaces pasteableBlock verbatim to user
   │      (c) user confirms second-LLM check passes
   ├── if any condition missing, emit "DO NOT SIGN. — Inv #12.5 second-LLM check incomplete"
   └── only when all conditions met, relay user's "send" intent to submit_safe_tx_signature

                                  │
                                  │  (parallel defense-in-depth track — preview path)
                                  ▼
   src/tools/preview_send.ts (Phase 37 isSafeExecTransaction branch — execute path)
   ├── inner-decode via decodeSingleSafeExecTransaction(record.tx.data)
   ├── re-emit hard-trigger blocks IFF inner SafeTx matches selector/operation
   │       (defense-in-depth for cross-signer scenario where executor's
   │        MCP session lacks the propose-side state)
   └── append to existing safeExecDecodeBlock + safeExecWarnBlock response text
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@2.x` (existing per Phase 1) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run test/<file>.test.ts` |
| Full suite command | `npx vitest run` (currently ~4850 tests post-Phase 37 Plan 37-01) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-09 | `enableModule(address)` selector === `0x610b5925` | unit | `npx vitest run test/protocols-safe.test.ts -t "selector"` | ❌ Wave 0 |
| SAFE-09 | `decodeEnableModuleCalldata` round-trip via Fixture SAFE-G | unit | `npx vitest run test/protocols-safe.test.ts -t "Fixture SAFE-G"` | ❌ Wave 0 |
| SAFE-09 | `isEnableModuleCalldata` lowercase-normalized + negative cases | unit | `npx vitest run test/protocols-safe.test.ts -t "predicate"` | ❌ Wave 0 |
| SAFE-09 | propose emits MODULE ENABLE block when calldata matches AND to === safeAddress | unit | `npx vitest run test/prepare-safe-tx-propose.test.ts -t "MODULE ENABLE"` | ✅ (EXTEND) |
| SAFE-09 | propose emits DELEGATECALL block when operation === "delegatecall" | unit | `npx vitest run test/prepare-safe-tx-propose.test.ts -t "DELEGATECALL"` | ✅ (EXTEND) |
| SAFE-09 | propose emits BOTH blocks (composite) in MODULE ENABLE → DELEGATECALL order | unit | `npx vitest run test/prepare-safe-tx-propose.test.ts -t "composite"` | ✅ (EXTEND) |
| SAFE-09 | propose REMOVES the Phase 37 informational `delegatecall: YES` line from CHECKS PERFORMED | regression | `npx vitest run test/prepare-safe-tx-propose.test.ts -t "informational line removed"` | ✅ (EXTEND) |
| SAFE-09 | approve emits MODULE ENABLE / DELEGATECALL / composite from Tx-Service-fetched data | unit | as above, swap `propose` → `approve` | ✅ (EXTEND) |
| SAFE-09 | execute emits MODULE ENABLE / DELEGATECALL / composite from inner-decoded SafeTx | unit | as above, swap `propose` → `execute` | ✅ (EXTEND) |
| SAFE-09 | preview_send re-emits MODULE ENABLE / DELEGATECALL when isSafeExecTransaction === true and inner matches | unit | `npx vitest run test/preview-send.safe-execute.test.ts -t "hard-trigger re-emission"` | ✅ (EXTEND) |
| SAFE-09 | `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` substitution shape (all placeholders filled) | unit | `npx vitest run test/signing-blocks-hard-trigger.test.ts -t "substitution"` | ❌ Wave 0 |
| SAFE-09 | skill-integrity v1.4 SHA pin matches sister-repo content | unit | `npx vitest run test/security-skill-integrity.test.ts -t "v1.4 SHA"` | ✅ (EXTEND) |
| SAFE-09 | INSTRUCTIONS interpolation (server.ts:52) references v1.4 | unit | `npx vitest run test/server.test.ts -t "v1.4 INSTRUCTIONS"` | ✅ (EXTEND or new) |

### Sampling Rate

- **Per task commit:** `npx vitest run test/<file>.test.ts` for the file(s) the commit touched.
- **Per wave merge:** `npx vitest run test/protocols-safe.test.ts test/prepare-safe-tx-*.test.ts test/preview-send.safe-execute.test.ts test/security-skill-integrity.test.ts` (Phase 38 surface — ~6 files).
- **Phase gate:** Full suite green (`npx vitest run`) before `/gsd-verify-phase`. Test count delta projected ~+27 to +32 across Plan 38-01 (Plan 38-02 ships zero main-repo tests — sister-repo CI deferred per gh OAuth constraint).

### Wave 0 Gaps

- [ ] `test/protocols-safe.test.ts` — Fixture SAFE-G selector + decoder + predicate (NEW file)
- [ ] `test/signing-blocks-hard-trigger.test.ts` — template substitution shape regression (NEW file)
- [ ] `test/prepare-safe-tx-propose.test.ts` extension — emission + informational-line-removed
- [ ] `test/prepare-safe-tx-approve.test.ts` extension — same
- [ ] `test/prepare-safe-tx-execute.test.ts` extension — same (using inner-decoded SafeTx)
- [ ] `test/preview-send.safe-execute.test.ts` extension — re-emission at preview
- [ ] `test/security-skill-integrity.test.ts` extension — v1.4 SHA pin + prose update

### Minimum bar to claim "code-complete" (Plan 38-01)

All new + extended tests pass + Phase 36 + Phase 37 + earlier-phase suites stay green + FROZEN-area zero-diff held across `src/signing/payload-fingerprint.ts`, `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` three gates, Phase 37 cryptographic-binding fixtures SAFE-A/B/C/D (`test/signing-fingerprint.test.ts` + `test/signing-safe-tx-hash.test.ts`). Plan 38-02 sister-repo deliverable: v1.4 release tag pushed on `szhygulin/vaultpilot-preflight-skill`; SKILL.md byte-identical to main-repo `38-02-SKILL-TEMPLATE.md`; CHANGELOG.md updated.

Real-Ledger smoke test (mainnet 1-of-1 Safe propose → submit → execute with hard-trigger block emission and second-LLM ritual traversal) deferred to v2.5 verify-phase per Phase 36 close-out cadence.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing WC v2 session ownership (Phase 3) |
| V3 Session Management | yes | Existing WC v2 session expiry (Phase 3); skill SHA pin (Phase 9 + Phase 38 v1.4 update) |
| V4 Access Control | yes | On-chain owner set cross-check (Phase 36 + Phase 37 reuse); hard-trigger block + skill HALT condition for high-blast-radius ops |
| V5 Input Validation | yes | viem typing for Hex / Address; `decodeFunctionData` throws on malformed calldata; structured refusal at truncated enableModule calldata |
| V6 Cryptography | yes | viem.keccak256 / viem.toFunctionSelector (selector computation); no hand-rolled crypto |
| V8 Data Protection | n/a | No private key material crosses this codebase boundary (CLAUDE.md invariant) |
| V9 Communication | yes | HTTPS to Safe Tx Service (Phase 36); WSS via WC relay (Phase 3) |

### Known Threat Patterns for Safe high-blast-radius operations

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `enableModule` (drain attack) | T + E | MCP-side hard-trigger block + skill-side Inv #12.5 HALT + second-LLM out-of-band decode via `get_verification_artifact` |
| `delegatecall` upgrade attack (rewrite owner set / threshold / implementation) | T + E | Same as `enableModule` defense — `delegatecall` discriminator catches `changeMasterCopy`-style proxy upgrade attacks by construction |
| `enableModule` calldata embedded inside `delegatecall` payload (composite scenario) | T + E | Composite emission of BOTH blocks; skill keys on titles independently; user must satisfy BOTH second-LLM checks |
| Cross-signer execute path missing propose-side trigger (executor's MCP session lacks state) | T (defense-in-depth) | `preview_send` re-emits at execute path via `isSafeExecTransaction` sentinel + inner-decode |
| Skill block-title scan drift (MCP-side title changes, skill scans for old string) | T | Format-fanout-sentinel: titles live in ONE place (`src/signing/blocks.ts`); regression test `test/signing-blocks-hard-trigger.test.ts` anchors literal title shape |
| `vaultpilot-preflight` skill not installed (defense-in-depth absent) | I | `VAULTPILOT NOTICE — skill not installed` block emitted on first dispatch (Plan 09-02 dispatcher-wrap); user sees the gap explicitly |
| Skill SHA pin drift between MCP build and sister-repo release | T | Plan 38-01 commits SHA pin BEFORE Plan 38-02 tags release (mirror of 09-01 → 09-02 sequencing); README documents Expected SHA cross-check |

## Sources

### Primary (HIGH confidence)

- `[VERIFIED: viem.toFunctionSelector('enableModule(address)') === '0x610b5925']` — computed in-session against installed viem@2.48.11
- `[VERIFIED: codebase Read 2026-05-27]` — `src/tools/prepare_safe_tx_propose.ts:537-539`, `src/tools/prepare_safe_tx_approve.ts:409-413`, `src/tools/prepare_safe_tx_execute.ts:538-542`, `src/tools/preview_send.ts:1873-1968`, `src/signing/safe-exec-decode.ts:1-138`, `src/signing/handle-store.ts:982-1057`, `src/security/skill-integrity.ts:1-192`, `src/signing/blocks.ts:1-2917`, `src/tools/get_verification_artifact.ts:1-138`, `src/server.ts:1-221`
- `[VERIFIED: codebase Read 2026-05-27]` — `.planning/phases/09-hardening-skill-and-verification-tools/09-01-PLAN.md`, `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md`
- `[VERIFIED: codebase Read 2026-05-27]` — `.planning/phases/37-safe-three-step-signing-flow/37-CONTEXT.md`, `.planning/phases/37-safe-three-step-signing-flow/37-RESEARCH.md`, `.planning/phases/37-safe-three-step-signing-flow/37-PATTERNS.md`
- `[VERIFIED: SECURITY.md grep + read]` — section structure from line 1 to 572; no §6 Safe section currently exists

### Secondary (MEDIUM confidence)

- Safe Smart Account v1.3.0 / v1.4.1 ABI — `[CITED: github.com/safe-global/safe-smart-account]` enableModule signature confirmed via viem (selector matches the canonical computation)
- Safe module documentation — `[CITED: docs.safe.global/advanced/smart-account-modules]`
- Locally-installed skill at `~/.claude/skills/vaultpilot-preflight/SKILL.md` — `[NOTED-AS-DIFFERENT-UPSTREAM]` from a different repo (`vaultpilot-security-skill`); not used as insertion reference

### Tertiary (LOW confidence — flagged for validation)

- `docs.safe.global/reference-smart-account/modules/enableModule` WebFetch returned `0xa7e28ebd` selector — DISCOUNTED (viem-computed value is `0x610b5925` and matches CONTEXT lock; the docs-page extraction is a hallucination, not a sourced fact)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `get_verification_artifact` tool's sparse JSON output for a `PreparedTxSafeTypedData` handle (sentinel EVM fields) is operationally meaningful enough for the second-LLM ritual without extending the tool. | Topic 3 (caveat) | Researcher recommends EXTENDING `get_verification_artifact` to dispatch on `txType` — option (a). If executor proceeds without the extension, the hard-trigger block's "Step 1: run `get_verification_artifact`" instruction returns a sparse JSON with zero-valued sentinels — useless for second-LLM decode. Flagged as DESIGN FORK requiring planning-gate resolution. |
| A2 | Phase 38's emission sites at `prepare_safe_tx_propose.ts` / `_approve.ts` / `_execute.ts` / `preview_send.ts` are SUFFICIENT — `submit_safe_tx_signature` does NOT need re-emission. | CONTEXT lock + § Claude's Discretion | If a paired Ledger user co-signs via `submit_safe_tx_signature` in a session that ALREADY traversed the hard-trigger block at propose/approve, no re-emission is needed (already user-confirmed). If submit is called against a handle from a different session (e.g. signature relay), the skill-side scan on the submit response would not catch it — but submit is post-signature, the trust anchor (Ledger device screen) has already fired. CONTEXT-locked default: NO re-emission at submit. |
| A3 | Sister-repo `gh OAuth workflow-scope` constraint carries forward at Plan 38-02 — same as Plan 09-01 W-1. | Topic 5 | If the user's gh OAuth scope has been EXPANDED since Plan 09-01 (`gh auth refresh -s workflow`), Plan 38-02 COULD ship CI workflow. Researcher does NOT verify scope at research time — assumes carry-forward per CONTEXT line 120. Surface to user at Plan 38-02 execute time. |
| A4 | The locally-installed SKILL.md at `~/.claude/skills/vaultpilot-preflight/SKILL.md` (from `vaultpilot-security-skill` upstream) is NOT the canonical insertion reference for Plan 38-02; the canonical reference is `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md`. | Topic 6 | If the user expects the locally-installed copy to be the upstream (the personal-scope install IS the user's authoritative skill), Plan 38-02 may ship to the WRONG repo. Surface to user at Plan 38-02 execute time — confirm sister-repo target is `szhygulin/vaultpilot-preflight-skill` (NOT `vaultpilot-security-skill`). Bizarre that the personal-scope skill is from a different repo than the main repo's planning template — possible user-side install error. **STRONG SIGNAL for user-confirmation at planning gate.** |
| A5 | SECURITY.md has NO §6 Safe section currently; Phase 38 ADDS a new top-level section. CONTEXT.md's reference to "§6" is anachronistic. | Topic 7 | If the user intends "§6" to refer to a different existing section (e.g. the WC Session Persistence at line 40 is sometimes called §6 in v1.0.1 docs), the placement may be misread. Researcher's recommendation: ADD new section at end-of-file (after Phase 32) — matches the Phase-by-Phase append discipline. |

**If this table is empty:** Not applicable; 5 assumptions surfaced. Plan 38-01 execute-time should resolve A1 + A4 + A5 explicitly.

## Open Questions

> Per CONTEXT design-fork discipline, researcher pre-locks DF-1 (REPLACE) + DF-2 (REPLACE). The questions below are the ones the planner needs the user to decide BEFORE execution.

1. **`get_verification_artifact` extension for `PreparedTxSafeTypedData` handles (A1 above)** — Plan 38-01 scope decision.
   - **What we know:** `get_verification_artifact` operates on EVM-shape sentinel fields. Safe-typed-data handles have sentinel `chainId: 0`, `to: ZERO_ADDRESS`, `valueWei: 0n`, `data: "0x"` — the real SafeTx data lives in `safeTxTo`, `safeTxValue`, `safeTxData`. The hard-trigger block instructs the agent to invoke this tool; without an extension, the output is useless.
   - **What's unclear:** Whether the executor accepts the small extension (~30 lines: new `PASTEABLE_BLOCK_TEMPLATE_SAFE` constant + `txType`-dispatch in `get_verification_artifact.ts`) into Plan 38-01 scope.
   - **Recommendation:** Include the extension in Plan 38-01. Surface this at planning gate IF executor disagrees.

2. **A4 — local-install skill upstream divergence** — Plan 38-02 target confirmation.
   - **What we know:** The locally-installed `~/.claude/skills/vaultpilot-preflight/SKILL.md` references `github.com/szhygulin/vaultpilot-security-skill` as its trust root — a DIFFERENT repo than the main repo's planning-time template (`vaultpilot-preflight-skill`). 
   - **What's unclear:** Whether this is (a) a user-side install error (the user installed the wrong skill), (b) a deliberate fork the user maintains separately, or (c) `vaultpilot-security-skill` IS the canonical upstream and `vaultpilot-preflight-skill` is dead/wrong.
   - **Recommendation:** Plan 38-02 confirms target via `gh repo view szhygulin/vaultpilot-preflight-skill` AND `gh repo view szhygulin/vaultpilot-security-skill` at execute-time; surfaces both repo states to the user and obtains confirmation before tagging v1.4. **STRONGLY recommend user-confirmation checkpoint before Plan 38-02 push.**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `viem` (npm) | selector / decoder | ✓ | 2.48.11 | — |
| `gh` CLI | sister-repo tag push (Plan 38-02) | ✓ (assumed; Plan 09-01 worked) | — | git push origin v1.4 via raw git (no PR; no checks) |
| `sha256sum` (Linux) / `shasum -a 256` (macOS) | Plan 38-01 SHA computation | ✓ (POSIX) | — | Node `crypto.createHash('sha256')` from `src/security/skill-integrity.ts:38` reuses the same SHA-256 logic — researcher script can compute SHA via Node if shell utility unavailable |
| `gh auth scope = workflow` | Plan 38-02 CI workflow push (if not deferred) | ✗ (per CONTEXT line 120; carry-forward from Plan 09-01 W-1) | — | Defer CI workflow; v1.4 ships without `.github/workflows/ci.yml` |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `gh auth scope = workflow` — fallback is "defer CI workflow" (CONTEXT-locked).

---

*Phase: 38-safe-enable-module-delegate-call-second-llm*
*Research date: 2026-05-27*
*Valid until: 2026-06-27 (30-day stability window; selector + ABI are byte-stable; sister-repo upstream divergence (A4) is the only fluid signal)*
