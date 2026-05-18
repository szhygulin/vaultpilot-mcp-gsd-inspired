# Phase 9: Hardening — skill + three verification tools + dispatch allowlist — Research

**Researched:** 2026-05-18
**Domain:** Companion `vaultpilot-preflight` Claude Code skill (sister-repo, SHA-pinned, integrity self-check) + server-side skill integrity surfacing (`VAULTPILOT NOTICE` block) + three new verification tools (`get_verification_artifact` for second-LLM cross-check, `verify_tx_decode` for server-side decode lie-detection, `get_tx_verification` re-emit re-spec) + outer dispatch-target allowlist enforcement (`src/security/canonical-dispatch.ts`) + WC session-topic surfacing in every signing flow
**Confidence:** HIGH on (a) Claude Code skill structure + frontmatter shape — empirically verified against code.claude.com/docs/en/skills 2026-05-18; (b) cryptographic-binding chain FROZEN-area zero-diff feasibility — Phase 9 layers on TOP of unchanged signing pipeline, mirror of Phase 8's discipline; (c) `get_tx_verification` PRE-EXISTS from Plan 04-05 (PR #14) — 09-05 is a RE-SPEC / extension, not a new tool; (d) `[SET-LEVEL ENUMERATION]` block is byte-frozen external contract (T-SET-LEVEL-BLOCK-DRIFT-1) and the skill consumes it verbatim. MEDIUM on (e) `verify_tx_decode` divergence-list shape — patterns from Phase 7's `check_contract_security` 5-arm union are the closest analog but the field-by-field diff is a new shape; (f) server-side SHA-pin reachability — the file path the skill installs to (`~/.claude/skills/vaultpilot-preflight/SKILL.md` for personal scope, `<project>/.claude/skills/vaultpilot-preflight/SKILL.md` for project scope, OR plugin-scope path) requires probing multiple candidate locations; (g) per-chain dispatch-target allowlist scope — Phase 8 deliberately deferred per-chain `KNOWN_SPENDERS_*` widening (08-RESEARCH § Topic 7 line 1131 — "v1.3 widens to per-chain known-spender tables").

## Summary

Phase 9 closes the three load-bearing residual risks documented in SECURITY.md without modifying a single byte of the cryptographic-binding chain. The compromised-MCP threat (the v1.0–v1.2 "install from a pinned source you trust" residual) gets a load-bearing defense via the `vaultpilot-preflight` companion skill — a sister-repo `vaultpilot-preflight-skill` ships `SKILL.md` with a Step 0 mandatory integrity self-check that halts with `DO NOT SIGN.` on hash divergence, plus encodings of invariants #1, #2, #2.5, #5, #11, #14. The coordinated-agent threat (a fully-coordinated agent that fabricates both the args and the verification narrative) narrows via `get_verification_artifact` — sparse JSON + `pasteableBlock` with explicit copy markers that ship through a canned second-LLM prompt instructing out-of-band decode from scratch with zero shared context. The narrow-agent decode-lie threat (an agent that reports a decoded action that doesn't match the bytes) gets an inline server-side cross-check via `verify_tx_decode` — the agent passes its own decoded view, the server independently re-decodes via the existing `src/protocols/*.ts` decoders, and the response is `{ ok: true }` on match or `{ ok: false, divergences: [...] }` with field-by-field diff.

The outer dispatch-target allowlist lands at `src/security/canonical-dispatch.ts` (NEW file, NEW directory — there is no `src/security/` yet; the CLAUDE.md `## Architecture` block names it as planned). The allowlist enforces that `record.tx.to` for Aave / WETH / 1inch / LiFi / known protocol-router calls points at a canonical SOT address per chain — mismatch refuses at `preview_send` BEFORE block emission. Phase 8's `KNOWN_SPENDERS_ETHEREUM` (11 entries) is Ethereum-only by design; Phase 9 widens to per-chain `KNOWN_SPENDERS_*` (or — DF-2 recommendation — keeps the existing labels table and builds a parallel `CANONICAL_DISPATCH_TARGETS` table). `get_tx_verification` (PRE-EXISTS — Plan 04-05 PR #14) gets a minor v1.3 spec extension to surface the new VERIFY-BEFORE-SIGNING + tx-JSON-as-canonical-view shape, mostly additive structuredContent fields. WC session-topic cross-check is currently in `get_ledger_status` only (Plan 03-02); Phase 9 ensures every signing flow surfaces the topic (additive `sessionTopicLast8` field on `preview_send` / `send_transaction` / `pair_ledger_live` response).

**Primary recommendations** (locked at planning gate per Phase 5/6/7/8 reasonable-call discipline):

- **Skill installation flow:** clone-and-symlink (or `git clone <sister-repo> ~/.claude/skills/vaultpilot-preflight`) — NOT npm-installable. Claude Code skills live at a fixed filesystem path (`~/.claude/skills/<name>/SKILL.md` for personal, `.claude/skills/<name>/SKILL.md` for project) per [CITED: code.claude.com/docs/en/skills 2026-05-18]; the runtime expects file-on-disk, not a registered package. The sister repo's README provides the one-liner `git clone https://github.com/<user>/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight && cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0` (or similar tag-pin). The MCP server's `INSTRUCTIONS` field names the install path and the expected SHA-256.
- **Server-side SHA pin shape:** `~/.claude/skills/vaultpilot-preflight/SKILL.md` is the primary probe path; project-scope path `<cwd>/.claude/skills/vaultpilot-preflight/SKILL.md` is the secondary probe. On EITHER path being readable, compute SHA-256 (Node `crypto.createHash("sha256")` — already available, no new dep; sanity-checked at runtime against `2cf24dba…` for `"hello"`); compare against `EXPECTED_SKILL_SHA256` constant. On (a) neither path exists OR (b) SHA mismatch, emit `VAULTPILOT NOTICE` block at the TOP of the FIRST tool response of the session (dispatcher-wrap shape from Plan 05-03's auto-demo NOTICE, same dedup-per-session pattern via `consumeSkillIntegrityNotice()` helper).
- **`get_verification_artifact` shape:** sparse JSON `{ to, valueWei, data, chainId, payloadFingerprint, presignHash }` plus a `pasteableBlock` text block bounded by explicit `>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>` markers (the canned-second-LLM prompt instructs the user "everything between these markers, paste verbatim into a fresh Claude / GPT / Gemini session"). The pasteableBlock contains the unsigned tx bytes (data), the chainId, and a canned prompt telling the second LLM "decode this from scratch, name the function called, the arguments, the recipient, the amount — do not refer to any external context." The user reads the second LLM's answer + compares against the first LLM's narrative.
- **`verify_tx_decode` shape:** `{ handle, claimedDecode: { to: Address, action: "transfer" | "approve" | "supply" | "withdraw" | ..., args: Record<string, string> } }`. Server independently decodes via `_protocols.decodeErc20Call` / `_aaveProtocols.decodeAaveV3Call` / `_wethProtocols.decodeWeth9Call` (same decoders `preview_send` uses — single SOT). Response is a 3-arm discriminated union mirroring `check_contract_security`'s 5-arm shape: `{ kind: "ok" }` | `{ kind: "divergence", divergences: Array<{ field, agentSaid, serverSays }> }` | `{ kind: "decode-unsupported", reason: string }` (the latter for protocols not yet covered — the agent gets a clear "I can't independently verify this; recommend `get_verification_artifact` for the second-LLM path").
- **Dispatch-target allowlist shape (DF-2 default):** build a parallel `CANONICAL_DISPATCH_TARGETS: Record<ChainId, ReadonlySet<Address>>` in `src/security/canonical-dispatch.ts` — NOT a widening of `KNOWN_SPENDERS_ETHEREUM`. Rationale: the spender-label table is a UI-surfacing concern (preview decoded-args block); the dispatch allowlist is a security gate (refuse at preview). Two tables with different purposes shouldn't share storage. The allowlist is sourced from the existing per-chain getter helpers in `src/config/contracts.ts` (`getAaveV3PoolAddress(chainId)`, `getWethAddress(chainId)`) + extension entries for 1inch V6 + LiFi diamond (per-chain — verified via existing `KNOWN_SPENDERS_ETHEREUM` row addresses for Ethereum, extension to L2s via published 1inch/LiFi address tables).
- **`get_tx_verification` re-spec:** existing tool (Plan 04-05 PR #14) — 09-05 ADDITIVELY extends with (a) a `VERIFY BEFORE SIGNING` block as the canonical user-facing summary (already in `src/signing/blocks.ts`); (b) `txJson` structuredContent field — the full unsigned tx as JSON, byte-equivalent to what `preview_send` would compute, so a context-evicted agent can re-relay the tx without re-running prepare. NO state-machine change; NO new TTL (15-min from Plan 04-01 `HANDLE_TTL_MS` is correct and unchanged).
- **WC session-topic surfacing:** additive `sessionTopicLast8: string` field on `preview_send` + `send_transaction` + `pair_ledger_live_wait` response structuredContent (currently only on `get_ledger_status` / `pair_ledger_live`). Pure addition — no FROZEN three-gate change.
- **Cryptographic-binding chain ZERO DIFF:** verified empirically against current source — `src/signing/payload-fingerprint.ts` (FROZEN since Phase 4), `src/signing/presign-hash.ts` (FROZEN since Phase 4), `src/signing/handle-store.ts` state machine (FROZEN), `src/tools/send_transaction.ts` three gates (FROZEN), Phase 7 Aave protocol-decode surface (FROZEN), Phase 8 chain-id Layer 2 + Layer 3 gates (FROZEN). Phase 9 NEW files only: `src/security/canonical-dispatch.ts`, `src/security/skill-integrity.ts`, `src/tools/verify_tx_decode.ts`, `src/tools/get_verification_artifact.ts`. Phase 9 MODIFY (additive only): `src/server.ts` (dispatcher-wrap for VAULTPILOT NOTICE), `src/tools/preview_send.ts` (additive `sessionTopicLast8` field + canonical-dispatch refusal gate BEFORE block emission), `src/tools/get_tx_verification.ts` (additive `txJson` field), `src/signing/blocks.ts` (additive `VAULTPILOT_NOTICE_TEMPLATE` + `DISPATCH_TARGET_REFUSAL_TEMPLATE`), `src/signing/error-codes.ts` (additive `SKILL_INTEGRITY_FAILURE` + `DISPATCH_TARGET_REFUSED` + `DECODE_DIVERGENCE` — three new codes, 16 → 19).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Companion skill (Claude Code agent runtime defense) | Sister repo `vaultpilot-preflight-skill` (NEW; outside this codebase) | Claude Code skills runtime (`~/.claude/skills/` filesystem) | The skill runs in the agent's runtime, NOT the MCP server. It re-derives + re-renders the payload on the agent side, encoding invariants #1/#2/#2.5/#5/#11/#14. Defense against compromised-MCP — without a second runtime independently verifying, the MCP is the only source of truth and a compromise is undetectable. |
| Skill integrity probe + SHA pin | MCP server (`src/security/skill-integrity.ts` — NEW) + `src/server.ts` dispatcher-wrap | Node `crypto.createHash("sha256")` + `fs/promises.readFile` | The MCP server detects whether the user has the skill installed and whether its content matches the SHA pin. Tampering surfaces via the `VAULTPILOT NOTICE` block on the first tool response (dedup-per-session). Same dispatcher-wrap shape as Plan 05-03's auto-demo NOTICE. |
| Outer dispatch-target allowlist | MCP server (`src/security/canonical-dispatch.ts` — NEW) | `src/config/contracts.ts` per-chain getter helpers + extension entries for non-spender canonical addresses | Server-side gate at `preview_send` — refuses if `record.tx.to` is not on the per-chain allowlist for the protocol-routed prepare tools (Aave, WETH, 1inch, LiFi). The escape hatch (`prepare_custom_call` with `acknowledgeNonProtocolTarget: true`) is v2.4 scope; v1.3 ships strict allowlist enforcement for the protocol-routed prepare tools only. |
| Server-side decode cross-check (`verify_tx_decode`) | MCP server (`src/tools/verify_tx_decode.ts` — NEW) | Existing decoders: `_protocols.decodeErc20Call` (Plan 06-02), `_aaveProtocols.decodeAaveV3Call` (Plan 07-03), `_wethProtocols` (Plan 06-04) | The server independently decodes via the same decoders `preview_send` uses (single SOT). Catches the narrow agent that misreports its decode — the bytes are byte-bound, but the agent's narrative is not. Defense against agents that decode incorrectly OR lie deliberately. |
| Out-of-band verification artifact (`get_verification_artifact`) | MCP server (`src/tools/get_verification_artifact.ts` — NEW) | Existing `lookup` (handle-store; 15-min TTL) + viem `serializeTransaction` helpers if needed | Sparse JSON + `pasteableBlock` text payload designed for paste into a second LLM with no shared context. The second LLM decodes from scratch; the user compares the two narratives. Defense against fully-coordinated agent compromise where args + output filter are both compromised. |
| 15-min handle re-emit (`get_tx_verification` v1.3) | MCP server (`src/tools/get_tx_verification.ts` — MODIFY additive) | Existing handle-store TTL (Plan 04-01 `HANDLE_TTL_MS`) + existing block templates | PRE-EXISTS from PR #14. v1.3 ADDS: `VERIFY BEFORE SIGNING` block to the previewed/sent text payload + `txJson` structuredContent field. Allows a context-evicted agent to re-relay the canonical view without re-running prepare (which would change `nonce` + `payloadFingerprint`). |
| WC session-topic cross-check (every signing flow) | MCP server (`src/tools/preview_send.ts` + `send_transaction.ts` + `pair_ledger_live_wait.ts` — MODIFY additive) | Existing `getStatus()` in `src/wallet/session-manager.ts` (sessionTopicLast8 already computed) | Additive surfacing: `sessionTopicLast8` field on every signing-flow response so the user can verify against Ledger Live → Settings → Connected Apps from any response, not just `get_ledger_status`. Defense against WC peer impersonation — if the topic on the response doesn't match what LL shows, the WC relay has been compromised. |
| Sister-repo skill build + release | Sister repo `vaultpilot-preflight-skill` (NEW; `gh repo create` against user namespace) + GitHub releases | None | Outside this codebase. The MCP server has no build-time dependency on the skill repo. The SHA pin in `src/security/skill-integrity.ts` is a STRING CONSTANT updated when the skill ships a new version (coordinated bump like the `[SET-LEVEL ENUMERATION]` block discipline). |

## Topics

### Topic 1: Claude Code skill structure + companion-skill installation flow (Plan 09-01)

**Recommendation:** Sister repo `vaultpilot-preflight-skill` ships `SKILL.md` at the repo root. Users install via `git clone <repo-url> ~/.claude/skills/vaultpilot-preflight` (personal scope — applies across all their projects) or `git clone <repo-url> <project>/.claude/skills/vaultpilot-preflight` (project scope — applies to that project only). The repo's README provides the canonical one-liner; the MCP server's `INSTRUCTIONS` field also names it. Tag releases (`v1.3.0`, `v1.3.1`, …); the MCP server pins a SHA-256 against the `SKILL.md` content at that tag. Users can `cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0` to pin.

**SKILL.md frontmatter shape** (verified empirically against code.claude.com/docs/en/skills, 2026-05-18):

```yaml
---
description: Pre-flight integrity self-check + on-chain transaction invariant enforcement for VaultPilot MCP. Use BEFORE confirming any transaction the user is about to sign on a Ledger. Halts with DO NOT SIGN. on integrity divergence.
allowed-tools: Bash(sha256sum *) Bash(shasum *)
disable-model-invocation: false
---

# vaultpilot-preflight

## Step 0 — MANDATORY integrity self-check
[sha256sum of THIS file] === [pinned SHA emitted in MCP `INSTRUCTIONS` field]?
  YES → continue
  NO  → emit "DO NOT SIGN. — skill integrity divergence" and HALT

## Step 1 — Invariant #1 (dispatch-target allowlist)
…

## Step 2 — Invariant #2 (payloadFingerprint match)
…

## Step 3 — Invariant #2.5 (chain must be explicit)
…

## Step 4 — Invariant #5 (final on-device match)
…

## Step 5 — Invariant #11 (decoded action matches user intent)
…

## Step 6 — Invariant #14 (revoke-flow set-level enumeration completeness)
…
```

**Frontmatter fields used** (per [CITED: code.claude.com/docs/en/skills, 2026-05-18]):
- `description` (recommended) — Claude uses this to decide when to auto-invoke. The phrase "Use BEFORE confirming any transaction" is the routing trigger.
- `allowed-tools` — pre-approves `sha256sum`/`shasum` for the Step 0 self-check; no per-use prompt.
- `disable-model-invocation: false` — model can auto-invoke (the user CAN also invoke explicitly via `/vaultpilot-preflight`).

**Installation paths** (verified):

| Scope | Path | When applicable |
|-------|------|-----------------|
| Personal | `~/.claude/skills/vaultpilot-preflight/SKILL.md` | All projects (recommended default for VaultPilot users) |
| Project | `<project>/.claude/skills/vaultpilot-preflight/SKILL.md` | Per-project (rare — only if user wants a different SKILL version per project) |
| Plugin (future) | `<plugin>/skills/vaultpilot-preflight/SKILL.md` | v1.4 scope if VaultPilot ships a Claude Code plugin |

[CITED: code.claude.com/docs/en/skills — "Where skills live" table]

**MCP server probe order** (Plan 09-02 implementation):
1. `~/.claude/skills/vaultpilot-preflight/SKILL.md` — primary (personal scope)
2. `<cwd>/.claude/skills/vaultpilot-preflight/SKILL.md` — secondary (project scope; only if user opted in)
3. Neither exists → `VAULTPILOT NOTICE — skill not installed` block (dedup per session)

**Why clone, not npm-installable:** Claude Code's skill runtime expects file-on-disk at the documented path. There is no npm package mechanism; the package would have to install files to `~/.claude/skills/` which is non-standard for npm install and would not respect the user's `~/.claude` directory ownership. Direct clone (or `gh repo clone`) is the canonical install vector. [CITED: code.claude.com/docs/en/skills — no mention of npm distribution]

**Why tag-pin not branch-pin:** A user on `main` would silently pick up a newer SKILL.md whose SHA doesn't match the MCP's pin. Tag-pinning (`git checkout v1.3.0`) keeps the SHA stable. The MCP server's `VAULTPILOT NOTICE` block surfaces SHA divergence — the user knows to either bump the MCP server (which pins a new SHA) or `git checkout` an older tag.

**SDK Probe Verdict — `@anthropic/claude-code-skills`:** NOT INSTALLED, NOT NEEDED. The skill is consumed by the AGENT'S Claude Code runtime; the MCP server only needs to READ the file from disk and SHA-256 it. No SDK for skill authoring — `SKILL.md` is a plain markdown file with YAML frontmatter.

**Sources:**
- [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills) — canonical SKILL.md frontmatter + installation paths (2026-05-18)
- [anthropics/skills GitHub](https://github.com/anthropics/skills) — example bundled skills (reference for structure)
- [Agent Skills open standard](https://agentskills.io) — cross-tool SKILL.md spec

### Topic 2: Invariant enumeration — what the skill encodes vs what the MCP enforces (Plans 09-01, 09-04)

**Recommendation:** The skill encodes 6 invariants (per SC #3 + the project's documented invariant set). Each maps to a specific compromise-model defense; some have MCP-side counterparts (defense-in-depth uniform), others are skill-only (load-bearing defense against compromised-MCP).

**Invariant table** (numbering per SECURITY.md + CLAUDE.md cross-references):

| # | Name | MCP-side enforcement | Skill-side enforcement | Defense model |
|---|------|----------------------|------------------------|--------------|
| #1 | Outer dispatch-target allowlist | `src/security/canonical-dispatch.ts` (Plan 09-04 NEW) — refuses at `preview_send` if `record.tx.to` not on per-chain allowlist | Skill re-asserts: `tx.to ∈ allowlist(chain)`; halts on miss | Defense-in-depth — Layer 1 (MCP-side refusal) + Layer 2 (skill-side cross-check). If MCP is compromised and skips the gate, skill catches. |
| #2 | `payloadFingerprint` matches between PREPARE RECEIPT and LEDGER BLIND-SIGN HASH | Plan 04-04 PREP-08 (`computePayloadFingerprint` re-check at send time; mismatch → `PAYLOAD_FINGERPRINT_DRIFT`) | Skill re-asserts: `sha256(domain-tag ‖ chainId ‖ to ‖ value ‖ data) === payloadFingerprint` | Defense-in-depth — Layer 1 is the FROZEN three-gate; skill independently re-derives the fingerprint to catch a compromised MCP that lies about it |
| #2.5 | Chain must be explicit (Phase 8 Layer 2) | `preview_send` chain-name MISMATCH refusal (Plan 08-02 — `CHAIN_ID_MISMATCH` errorCode 15) | Skill asserts: agent passed `chain` arg to `prepare_*`; refuses if missing | Defense — Phase 8's Layer 2 + Layer 3; skill adds defense-in-depth at the agent runtime layer (catches an agent that omits chain entirely and falls through to a server default) |
| #5 | Final on-device match | Out-of-MCP-scope (the device itself is the trust anchor) | Skill instructs: "before signaling user to approve, confirm `LEDGER BLIND-SIGN HASH` block displays the same value as the device screen" | Load-bearing for compromised-MCP — the device hash IS the trust anchor; skill instructs the user-facing ritual |
| #11 | Decoded action matches user's natural-language intent | `verify_tx_decode` (Plan 09-05 NEW) — server-side decode cross-check vs agent's claimed decode | Skill re-decodes via `viem.decodeFunctionData` locally; halts if local decode disagrees with agent's narrative | Load-bearing for narrow agent + coordinated agent — the bytes are byte-bound, but the AGENT'S DESCRIPTION of what the bytes do is not. Skill catches the lie at the agent runtime; MCP `verify_tx_decode` catches at the server. |
| #14 | Outer dispatch-target allowlist consumes `[SET-LEVEL ENUMERATION]` block (revoke-flow completeness) | Plan 08-04 ships the block (LOAD-BEARING — byte-frozen external contract per T-SET-LEVEL-BLOCK-DRIFT-1) | Skill parses `get_token_allowances` response → assembles per-chain dispatch allowlist for revoke prepares; refuses if revoke target not in enumerated set | Defense — completeness check: if the agent prepares a revoke for a spender NOT in the enumerated allowances, either the enumeration was wrong OR the revoke target was hallucinated. Skill catches both. |

**Phase 9 surfaces invariant #11 specification explicitly:** "decoded-action matches user-intent" is the load-bearing check that catches narrow agent lies. The shape: agent reads user prompt ("send 100 USDC to alice"), decides on `prepare_token_send`, calls `preview_send` → gets DECODED ARGS block → MUST report decoded action matches what user asked for. Skill enforcement: re-decode via viem from `data`, compare against agent's narrative. MCP enforcement: `verify_tx_decode({ handle, claimedDecode: { action: "transfer", recipient: "0xalice", amount: "100" } })` — server independently re-decodes and confirms or surfaces divergence.

**Invariants not yet specified in v1.x** (per ASSUMED — surfaced for verify-phase):

- **#1.b — typed-data dispatch-target allowlist** (for EIP-2612 permit / Permit2): out-of-scope per OUT_OF_SCOPE table; deferred to v3.x typed-data signing surface.
- **#2.b — typed-data digest recompute over decoded tree**: same deferral.
- **#6.b — bridge facet decoders (Wormhole / Across / Mayan)**: v2.6 scope (BRIDGE-T1-01..N).
- **#12.5 — Safe `enableModule` / `delegateCall: true` hard-trigger second-LLM**: v2.5 scope (SAFE-01..N).
- **#3 — `presignHash` matches device blind-sign display**: documented as the user's manual verification ritual (PREP-04 + the LEDGER BLIND-SIGN HASH block); not an automated invariant.
- **#4, #6, #7-10, #12-13, #15**: not specified in v1.x SECURITY.md; the 6 named here are what v1.3 ships. v2.x+ adds more as the surface grows.

**Pitfall:** The numbering (#1, #2, #2.5, #5, #11, #14) is non-contiguous because it mirrors the upstream `vaultpilot-mcp` numbering scheme (the project this codebase rebuilds from product specs). Don't renumber; the numbers ARE the user-facing contract. New invariants get the next available integer (`#3`, `#4`, etc.) — verify-phase task to check existing skill ecosystem documentation for unused numbers.

**Sources:**
- `./SECURITY.md` — Compromise Model section (cooperating agent / compromised agent / compromised MCP); names #1/#2/#2.5/#5/#11/#14 implicitly via the threat-defense pairing
- `./CLAUDE.md` — Architecture diagram + Conventions ("companion `vaultpilot-preflight` skill ships in v1.3 — until then, defense-in-depth is MCP-side only")
- `./PROJECT.md` Key Decisions table — "Defer companion skill (`vaultpilot-preflight`) to v1.3"
- `.planning/PROJECT.md` "Threat model" section — names compromised-MCP, narrow-agent, coordinated-agent threats explicitly

### Topic 3: SHA-256 pin mechanics + `VAULTPILOT NOTICE` block dispatcher-wrap (Plan 09-02)

**Recommendation:** Server computes the skill's SHA-256 lazily at the first tool dispatch of each session (NOT at server boot — boot-time IO blocks the initialize handshake per Phase 5 pitfall). Result is cached per session in a module-scoped flag; subsequent dispatches read the cached state at near-zero cost. On (a) skill file not found at either probe path OR (b) computed SHA ≠ `EXPECTED_SKILL_SHA256`, emit `VAULTPILOT NOTICE — skill integrity` block at the TOP of the first tool response that detects the failure (dedup via `consumeSkillIntegrityNotice()` helper; same pattern as Plan 05-03's `consumeAutoDemoNotice`).

**Shape** (closest analog: `src/diagnostics/notice.ts` + `src/server.ts:153-161` dispatcher-wrap from Plan 05-03):

```typescript
// Source: src/security/skill-integrity.ts (Plan 09-02 — sketch)
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// EXPECTED_SKILL_SHA256 — the SHA-256 of vaultpilot-preflight-skill v1.3.0's
// SKILL.md. Updated as a coordinated bump with the skill repo's tag release.
// Format-fanout-sentinel: this constant is the SOT; grep for the value
// returns exactly 1 hit across src/.
export const EXPECTED_SKILL_SHA256 = "<computed-at-skill-v1.3.0-release>";

const PROBE_PATHS = [
  () => join(homedir(), ".claude", "skills", "vaultpilot-preflight", "SKILL.md"),
  () => join(process.cwd(), ".claude", "skills", "vaultpilot-preflight", "SKILL.md"),
] as const;

export type SkillIntegrityState =
  | { kind: "ok"; path: string; sha256: string }
  | { kind: "missing"; pathsProbed: string[] }
  | { kind: "tampered"; path: string; computed: string; expected: string };

let cachedState: SkillIntegrityState | null = null;

export async function checkSkillIntegrity(): Promise<SkillIntegrityState> {
  if (cachedState !== null) return cachedState;
  const probed: string[] = [];
  for (const pathFn of PROBE_PATHS) {
    const path = pathFn();
    probed.push(path);
    try {
      const content = await readFile(path);
      const computed = createHash("sha256").update(content).digest("hex");
      cachedState =
        computed === EXPECTED_SKILL_SHA256
          ? { kind: "ok", path, sha256: computed }
          : { kind: "tampered", path, computed, expected: EXPECTED_SKILL_SHA256 };
      return cachedState;
    } catch {
      // ENOENT — try next probe path
    }
  }
  cachedState = { kind: "missing", pathsProbed: probed };
  return cachedState;
}

export const _skillIntegrity = { checkSkillIntegrity };  // ESM spy-affordance

// Dedup-per-session: emit NOTICE on the FIRST tool response that detects
// non-ok state, then suppress. Same shape as consumeAutoDemoNotice (05-03).
let noticeEmitted = false;
export function consumeSkillIntegrityNotice(state: SkillIntegrityState): string | null {
  if (noticeEmitted) return null;
  if (state.kind === "ok") return null;
  noticeEmitted = true;
  if (state.kind === "missing") {
    return VAULTPILOT_NOTICE_TEMPLATE_MISSING.replace(
      "{PATHS}",
      state.pathsProbed.join("\n    "),
    );
  }
  return VAULTPILOT_NOTICE_TEMPLATE_TAMPERED
    .replace("{PATH}", state.path)
    .replace("{COMPUTED}", state.computed)
    .replace("{EXPECTED}", state.expected);
}

export function _resetSkillIntegrityForTesting(): void {
  cachedState = null;
  noticeEmitted = false;
}
```

**Dispatcher-wrap shape** (in `src/server.ts`, AFTER the existing `runUpdateCheckOnce` + auto-demo NOTICE; mirror of Plan 05-03 Plan 05-03 lines 153-161):

```typescript
// In src/server.ts CallToolRequestSchema handler — AFTER the existing
// auto-demo NOTICE block, BEFORE returning result:
const integrityState = await _skillIntegrity.checkSkillIntegrity();
const skillNotice = consumeSkillIntegrityNotice(integrityState);
if (skillNotice !== null) {
  return {
    ...result,
    content: [{ type: "text" as const, text: skillNotice }, ...result.content],
  };
}
```

**`VAULTPILOT NOTICE` block templates** (additive to `src/signing/blocks.ts`):

```text
VAULTPILOT NOTICE — vaultpilot-preflight skill not installed
  The companion preflight skill is not installed at any of:
    {PATHS}
  Without the skill, defense-in-depth against a compromised-MCP scenario is
  reduced to MCP-side checks only (the trust anchor remains the Ledger device
  screen). To install:
    git clone https://github.com/<user>/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight
    cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0
  See ./SECURITY.md for the full residual-risk model.
```

```text
VAULTPILOT NOTICE — vaultpilot-preflight skill integrity mismatch
  Skill at: {PATH}
  Computed SHA-256: {COMPUTED}
  Expected SHA-256: {EXPECTED}
  The skill content differs from the version this MCP build pins. Either:
    (a) the skill was tampered with locally — re-clone or reset to the pinned tag
    (b) you have a newer skill version than this MCP — upgrade vaultpilot-mcp
    (c) you have an older skill version than this MCP — git checkout v1.3.0 in
        ~/.claude/skills/vaultpilot-preflight
  Until resolved, treat skill output as untrusted (the Ledger device screen
  remains the trust anchor; the skill is defense-in-depth).
```

**Dedup-per-session state lives in:** `src/security/skill-integrity.ts` module-scope `noticeEmitted: boolean` flag. NOT in `handle-store.ts` — handle-store is per-handle TTL state, not per-session dispatcher state. NOT in a separate dispatcher-wrap helper — keeping the dedup state co-located with the integrity check keeps the format-fanout-sentinel discipline (one module, one home for skill-integrity concerns).

**Reset hook for tests:** `_resetSkillIntegrityForTesting()` — same shape as `_resetAutoDemoNoticeForTesting` in `src/diagnostics/notice.ts`. Required because `vi.spyOn` won't unwind the module-scoped flag between test cases.

**Pitfall — fs/promises in stdio context:** Reading the skill file at the FIRST tool dispatch (not server boot) is critical. Boot-time IO would block the MCP `initialize` handshake (Phase 5 retro: blocking initialize is observable to the client). The lazy-on-first-dispatch shape mirrors `runUpdateCheckOnce` (Plan 05-03 DIAG-04) exactly.

**Pitfall — symlinks:** `~/.claude/skills/vaultpilot-preflight` may be a symlink to a cloned repo (some users `ln -s ~/projects/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight`). Node's `readFile` follows symlinks by default — no special handling needed. Computing SHA-256 against the dereferenced content is the correct behavior.

**Sources:**
- `src/diagnostics/notice.ts` (in-repo) — dedup-per-session pattern (`consumeAutoDemoNotice`)
- `src/server.ts:153-161` (in-repo) — dispatcher-wrap shape (auto-demo NOTICE prepend)
- Node.js `crypto.createHash` — empirically sanity-checked at runtime (`createHash("sha256").update("hello").digest("hex") === "2cf24dba…"`)

### Topic 4: `get_verification_artifact` shape — sparse JSON + `pasteableBlock` + canned second-LLM prompt (Plan 09-03)

**Recommendation:** Two outputs: (a) `structuredContent` carrying the sparse JSON `{ to, valueWei, data, chainId, payloadFingerprint, presignHash, selector }` — minimal field set, no narrative; (b) `content[0].text` carrying the `pasteableBlock` — bounded by explicit copy markers, contains a CANNED PROMPT instructing a second LLM to decode the bytes from scratch with no shared context. The user copies the block, pastes into a fresh Claude / GPT / Gemini session, reads the second LLM's answer, compares against the first LLM's narrative.

**Why this is distinct from existing PREPARE RECEIPT / SET-LEVEL ENUMERATION blocks:**

| Block | Audience | Purpose | Carries narrative? |
|-------|----------|---------|--------------------|
| `PREPARE RECEIPT` | User (visual verification) | Verbatim args agent passed | Yes (human-readable labels) |
| `LEDGER BLIND-SIGN HASH` | User (device verification) | Hash to match on device | No (raw hex only) |
| `[SET-LEVEL ENUMERATION]` | Skill (parser) | Outer dispatch allowlist source | No (parseable shape) |
| `DECODED ARGS` | User (intent verification) | Server's decode of the calldata | Yes (human-readable args) |
| `pasteableBlock` (NEW) | **Second LLM (out-of-band decode)** | **Raw bytes + canned prompt for fresh-session decode** | **No (the second LLM produces the narrative)** |

The `pasteableBlock` is the FIRST block in the project designed for a NON-HUMAN reader (other than the skill's `[SET-LEVEL ENUMERATION]` parser). The audience is a second LLM, and the design intent is "make it copy-paste-able without losing fidelity." Explicit copy markers (`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>` open, `<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<` close) frame the block so the user knows exactly what to copy.

**Shape** (sketch — type-checked against existing tool surface):

```typescript
// Source: src/tools/get_verification_artifact.ts (Plan 09-03 — sketch)
const DESCRIPTION = [
  "Emit a sparse JSON + paste-able block for SECOND-LLM out-of-band verification of a prepared transaction.",
  "Use AFTER preview_send and BEFORE send_transaction when the user wants an independent decode from a second LLM (catches coordinated-agent compromise where this agent's narrative cannot be trusted).",
  "Returns `{ to, valueWei, data, chainId, payloadFingerprint, presignHash }` as structuredContent + a `pasteableBlock` text payload bounded by explicit copy markers. Instruct the user: copy everything between the markers, paste into a fresh Claude/GPT/Gemini session, compare that LLM's decode against this conversation's narrative. Disagreement → DO NOT SIGN.",
  "Do NOT use as the only verification — the LEDGER BLIND-SIGN HASH on-device match is the trust anchor; this is defense-in-depth against a fully-coordinated agent compromise.",
  "15-min TTL from the original prepare. Past TTL → HANDLE_EXPIRED; re-run prepare.",
].join(" ");

registerTool("get_verification_artifact", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // ... handle lookup + TTL + status checks (mirror of get_tx_verification) ...
  const block = PASTEABLE_BLOCK_TEMPLATE
    .replace("{TO}", record.tx.to)
    .replace("{VALUE_WEI}", record.tx.valueWei.toString())
    .replace("{DATA}", record.tx.data)
    .replace("{CHAIN_ID}", String(record.tx.chainId))
    .replace("{PAYLOAD_FINGERPRINT}", record.payloadFingerprint)
    .replace("{PRESIGN_HASH}", pinned?.presignHash ?? "(not yet previewed)");
  return {
    content: [{ type: "text", text: block }],
    structuredContent: {
      to: record.tx.to,
      valueWei: record.tx.valueWei.toString(),
      data: record.tx.data,
      chainId: record.tx.chainId,
      payloadFingerprint: record.payloadFingerprint,
      presignHash: pinned?.presignHash ?? null,
      selector: record.tx.data === "0x" ? null : record.tx.data.slice(0, 10),
    },
  };
});
```

**`PASTEABLE_BLOCK_TEMPLATE`** (additive to `src/signing/blocks.ts`):

```text
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
COPY EVERYTHING BETWEEN THESE MARKERS INTO A FRESH CHAT WINDOW
(Claude, ChatGPT, Gemini — any LLM with no shared context with the agent that
prepared this transaction)

  You are verifying an Ethereum transaction. The agent that prepared this
  may be compromised. Decode it from scratch using only the bytes below.
  Do not consult any external context, any prior conversation, any file
  the user mentions. Use only the bytes.

  chainId:            {CHAIN_ID}
  to:                 {TO}
  value (wei):        {VALUE_WEI}
  data:               {DATA}
  payloadFingerprint: {PAYLOAD_FINGERPRINT}
  presignHash:        {PRESIGN_HASH}

  Tell the user:
    1. What function (if any) is being called (decode the first 4 bytes of `data`).
    2. What arguments are passed.
    3. What contract is being called (`to`) — name the protocol if you recognize it.
    4. Whether the recipient/spender/onBehalfOf in the args makes sense for the
       function called.
    5. Independently recompute the keccak256 of "VaultPilot-txverify-v1:" ‖
       chainId(32-byte BE) ‖ to(20 bytes) ‖ value(32-byte BE) ‖ data and confirm
       it equals payloadFingerprint above.

  Halt and refuse to sign if anything is suspicious. Explicitly note any
  divergence between your decode and what the prepare agent told the user.

<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
```

**How the second-LLM decode result feeds back:** The user reads the second LLM's answer and either:
- Confirms agreement with the first LLM → continues with `send_transaction`
- Detects divergence → halts; reports to user (or to vaultpilot-mcp issue tracker as a compromised-agent incident)

The MCP server has NO awareness of the second-LLM's answer; this is a USER ritual, not a tool round-trip. The block's design optimizes for paste fidelity + canned-prompt clarity, NOT for automation.

**Pitfall — long `data` hex breaks terminal paste:** ERC-20 transfer calldata is 68 bytes (138 hex chars + "0x"); Aave supply with `referralCode` is 132 bytes (266 hex chars). Both fit on a single line in most terminals. Long-calldata cases (Uniswap LP, Safe multisig) are out-of-scope for v1.3 (v2.4+ surface). The block design assumes single-line-per-field; no continuation markers needed at v1.3 scope.

**Pitfall — second LLM may refuse to compute keccak:** Some LLMs refuse to evaluate cryptographic primitives without tools. The Step 5 ("Independently recompute the keccak256") is recommended but not load-bearing; the load-bearing checks are #1-4 (decode the bytes). Failure to compute keccak → user falls back to MCP's `verify_tx_decode` (Plan 09-05) which DOES do server-side decode + the `payloadFingerprint` re-check is on the FROZEN three-gate.

**Sources:**
- `src/tools/get_tx_verification.ts` (in-repo) — precedent for handle-lookup + status-aware re-emit shape
- `src/signing/blocks.ts` (in-repo) — format-fanout-sentinel discipline (one block, one home)
- Plan 04-05 / PR #14 (`get_tx_verification` original implementation) — TTL semantics + structuredContent shape

### Topic 5: `verify_tx_decode` cross-check semantics (Plan 09-05)

**Recommendation:** Server independently decodes via the existing `src/protocols/*.ts` decoders (single SOT — same code path `preview_send` uses, no parallel decoder). Response is a 3-arm discriminated union (mirror of `check_contract_security`'s 5-arm shape but tighter — fewer protocol-state arms): `{ kind: "ok" }` | `{ kind: "divergence", divergences: Divergence[] }` | `{ kind: "decode-unsupported", reason: string }`. The `decode-unsupported` arm fires for arbitrary contract calls outside the v1.3-covered protocols (ERC-20, WETH9, Aave V3); the agent gets a clear "I can't independently verify this; fall back to `get_verification_artifact` for the second-LLM path."

**Shape** (sketch — type-checked against existing tools):

```typescript
// Source: src/tools/verify_tx_decode.ts (Plan 09-05 — sketch)
type Divergence = {
  field: string;        // e.g. "to" / "recipient" / "amount" / "spender"
  agentSaid: string;    // serialized claim
  serverSays: string;   // serialized server decode
};

type VerifyTxDecodeResult =
  | { kind: "ok" }
  | { kind: "divergence"; divergences: Divergence[] }
  | { kind: "decode-unsupported"; reason: string };

const DESCRIPTION = [
  "Server-side cross-check of the agent's claimed bytes-to-intent decode for a prepared transaction.",
  "Use AFTER preview_send and BEFORE send_transaction. The agent passes its OWN decoded view of the calldata; the server independently re-decodes via the same decoder preview_send uses and returns `{ ok }` on match or `{ ok: false, divergences: [{field, agentSaid, serverSays}] }` with field-by-field diff.",
  "Distinct from get_verification_artifact — that's an OUT-OF-BAND second-LLM check; this is an INLINE server-side cross-check that catches narrow agent decode lies before the user is asked to confirm.",
  "Returns `{ kind: 'ok' | 'divergence' | 'decode-unsupported' }` discriminated union. `decode-unsupported` fires for contracts outside the v1.3 decoder coverage (ERC-20, WETH9, Aave V3) — fall back to get_verification_artifact for second-LLM verification.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: { type: "string" },
    claimedDecode: {
      type: "object",
      properties: {
        to: { type: "string" },
        action: { type: "string", enum: ["transfer", "approve", "withdraw", "supply", "aave-withdraw"] },
        args: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["to", "action", "args"],
    },
  },
  required: ["handle", "claimedDecode"],
  additionalProperties: false,
};
```

**Field comparison rules** (per-action):

| Action | Compared fields | Tolerances |
|--------|-----------------|-----------|
| `transfer` | `to` (record.tx.to — token contract), `recipient` (decoded), `amount` (decoded — string ↔ string equality on the WEI value) | Exact equality. Decimal-string ambiguity caught at prepare time per `parseAmountStrict` (Phase 6 DF-2); agent claims `"100"` and decoded WEI = `100000000` for USDC → divergence on `amount` field, surfacing as `agentSaid: "100", serverSays: "100000000 (or 100 with 6 decimals)"`. Add a `note` field when decimals are ambiguous. |
| `approve` | `to` (token contract), `spender` (decoded), `amount` (decoded — `"max"` ↔ `MAX_UINT256` strict-equality) | `"max"` agent claim must equal `2^256-1` server decode; non-max requires exact-equality. `spenderLabel` mismatch (agent says "Aave Pool" but address ≠ KNOWN_SPENDERS_ETHEREUM[0]) reported via lookup. |
| `withdraw` (WETH9) | `to` (must be canonical WETH9 per chain), `amount` (decoded) | Exact equality on `to`. Phase 6 SOT cross-check: agent says `to: "0xc02aaa…"` (canonical WETH on Ethereum) but server decodes `data` and finds `to` from `getWethAddress(chainId)` mismatch → divergence. |
| `supply` (Aave V3) | `to` (Aave Pool per chain), `asset` (decoded), `amount` (decoded), `onBehalfOf` (decoded — server-derived from sender per Plan 07-03 lock) | Exact equality. Per-chain Pool address from `getAaveV3PoolAddress(chainId)` — agent claims `to: <ethereum pool>` but record is for Polygon → divergence on `to`. |
| `aave-withdraw` | Same as supply, with `to` field instead of `onBehalfOf` | Exact. |

**Failure modes when decoder lacks coverage:**

```typescript
// Pseudocode for the "decode-unsupported" arm:
const erc20Decoded = _protocols.decodeErc20Call(record.tx.data);
const aaveDecoded = _aaveProtocols.decodeAaveV3Call(record.tx.data);
if (erc20Decoded.kind === "unknown" && aaveDecoded.kind === "unknown") {
  return {
    content: [{ type: "text", text: "decode-unsupported: …" }],
    structuredContent: {
      kind: "decode-unsupported" as const,
      reason: `selector ${selector} not covered by v1.3 decoders (ERC-20 transfer/approve, WETH9.withdraw, Aave V3 supply/withdraw). Use get_verification_artifact for second-LLM out-of-band verification.`,
    },
  };
}
```

**Why mirror `check_contract_security`'s 5-arm shape (but tighter):** Phase 7 Plan 07-04 established the discriminated-union pattern with explicit `kind` field; the agent's switch-statement habit lifts cleanly. The 5 arms in `check_contract_security` (`not-applicable | ok | not-verified | error | rate-limited`) reflect operational vs protocol states; `verify_tx_decode` has 3 arms (`ok | divergence | decode-unsupported`) — fewer because the decode operation is deterministic (no rate-limits, no "error" arm because we don't call external services).

**Test surface anchor** (Wave 0 gap — NEW):

- `test/verify-tx-decode.test.ts` — covers (a) ok arm for transfer/approve/withdraw/supply/aave-withdraw happy paths against the existing Fixtures D/E/F/G/H byte-identity literals; (b) divergence arm for each action with a 1-field flip (recipient address typo, amount off-by-one wei, asset substitution); (c) decode-unsupported arm for `data: "0xdeadbeef..."` selector not in any decoder; (d) `claimedDecode.to` ↔ `record.tx.to` mismatch (e.g., agent claims `to` is the token but record says the Aave Pool — Aave T-AAVE-TX-TO-CONFUSION-1 specifically).

**Sources:**
- `src/protocols/erc20.ts` (in-repo) — `decodeErc20Call` discriminated union shape (4 arms: transfer / approve / withdraw / unknown)
- `src/protocols/aave-v3.ts` (in-repo) — `decodeAaveV3Call` (3 arms: aave-supply / aave-withdraw / unknown)
- `src/protocols/weth9.ts` (in-repo) — WETH9 selectors
- `src/tools/check_contract_security.ts` (in-repo) — 5-arm discriminated union analog (Plan 07-04)
- `src/tools/preview_send.ts:381-447` (in-repo) — selector-routed decoder dispatch + DECODED ARGS block (the same dispatch pattern `verify_tx_decode` re-uses)

### Topic 6: Outer dispatch-target allowlist — per-chain shape at `src/security/canonical-dispatch.ts` (Plan 09-04)

**Recommendation:** Build a parallel `CANONICAL_DISPATCH_TARGETS: Record<ChainId, ReadonlySet<Address>>` table in `src/security/canonical-dispatch.ts` — NOT a widening of `KNOWN_SPENDERS_ETHEREUM`. Source per-chain entries from the existing `src/config/contracts.ts` getters (`getAaveV3PoolAddress(chainId)`, `getWethAddress(chainId)`) PLUS extension entries for the non-spender canonical contracts (1inch V6 router, LiFi diamond — currently Ethereum-only in `KNOWN_SPENDERS_ETHEREUM`, extended per-chain via published address tables). DF-2 below makes this decision explicit.

**Per-chain allowlist shape:**

```typescript
// Source: src/security/canonical-dispatch.ts (Plan 09-04 — sketch)
import { getAddress, type Address } from "viem";

import {
  getAaveV3PoolAddress,
  getWethAddress,
  type ChainId,
} from "../config/contracts.js";

// Per-chain canonical dispatch targets. Sourced from:
//   - `src/config/contracts.ts` per-chain getters (Aave V3 Pool, WETH9)
//   - Inline literals for cross-chain DEX routers + bridges that aren't
//     yet in the SOT (1inch V6, LiFi diamond — same address per chain by
//     design; verified per-chain via 1inch portal + LiFi docs)
//
// Format-fanout-sentinel: this Set IS the SOT for the allowlist gate; the
// Aave + WETH addresses are SOURCED via the existing getter helpers (no
// duplication), the cross-chain DEX/bridge addresses are inline literals
// (no per-chain getter exists for them).

const ONEINCH_V6_ROUTER_ALL_CHAINS = getAddress(
  "0x111111125421cA6dc452d289314280a0F8842A65"  // same on Ethereum/Arbitrum/Polygon/Base/Optimism per 1inch portal
);

const LIFI_DIAMOND_ALL_CHAINS = getAddress(
  "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"  // same on Ethereum/Arbitrum/Polygon/Base/Optimism per LiFi docs
);

function buildPerChainAllowlist(chainId: ChainId): ReadonlySet<Address> {
  return new Set<Address>([
    getAaveV3PoolAddress(chainId),
    getWethAddress(chainId),
    ONEINCH_V6_ROUTER_ALL_CHAINS,
    LIFI_DIAMOND_ALL_CHAINS,
  ]);
}

export const CANONICAL_DISPATCH_TARGETS: Readonly<Record<ChainId, ReadonlySet<Address>>> = {
  1:     buildPerChainAllowlist(1),
  42161: buildPerChainAllowlist(42161),
  137:   buildPerChainAllowlist(137),
  8453:  buildPerChainAllowlist(8453),
  10:    buildPerChainAllowlist(10),
};

export type DispatchCheckResult =
  | { kind: "ok" }
  | { kind: "refused"; chain: ChainId; to: Address; allowlist: Address[] };

export function checkDispatchTarget(chainId: ChainId, to: Address): DispatchCheckResult {
  const checksummed = getAddress(to);
  const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];
  if (allowlist.has(checksummed)) return { kind: "ok" };
  return { kind: "refused", chain: chainId, to: checksummed, allowlist: [...allowlist] };
}

export const _canonicalDispatch = { checkDispatchTarget };  // ESM spy-affordance
```

**Wiring** (in `src/tools/preview_send.ts`, BEFORE the existing chain-id mismatch refusal at line 173):

```typescript
// NEW Plan 09-04: outer dispatch-target allowlist refusal — Layer 0.
// Fires BEFORE Layer 2 chain-name check + Layer 3 fingerprint drift.
// Only fires when (a) record.tx.data !== "0x" (contract call, not native
// send) AND (b) tool used was a protocol-routed prepare (NOT prepare_native_send).
// Native sends bypass the allowlist (any `to` is valid for a value transfer).
if (record.tx.data !== "0x") {
  const dispatchCheck = _canonicalDispatch.checkDispatchTarget(
    record.tx.chainId as ChainId,
    record.tx.to,
  );
  if (dispatchCheck.kind === "refused") {
    const refusalText = DISPATCH_TARGET_REFUSAL_TEMPLATE
      .replace("{CHAIN}", chainNameFromId(record.tx.chainId as ChainId))
      .replace("{TO}", record.tx.to)
      .replace("{ALLOWLIST}", dispatchCheck.allowlist.join("\n    "));
    return {
      isError: true,
      content: [{ type: "text", text: refusalText }],
      structuredContent: errEnvelope(
        "DISPATCH_TARGET_REFUSED",
        `tx.to ${record.tx.to} is not in the v1.3 canonical dispatch allowlist for chain ${record.tx.chainId}`,
      ),
    };
  }
}
```

**Per-Phase-8 reuse:** `KNOWN_SPENDERS_ETHEREUM` from Plan 06-03 is Ethereum-only (per the explicit Phase 8 deferral — 08-RESEARCH § Topic 7 line 1131: "Phase 8 verify-phase task: confirm `lookupSpender` semantics for non-Ethereum chains; planning recommendation locked: NO per-chain `KNOWN_SPENDERS_*` tables in v1.2"). Phase 9 closes this gap PARTIALLY (only for the dispatch-allowlist concern, not for the UI-label-resolution concern):

- v1.3 SHIPS: per-chain dispatch-target allowlist (this topic)
- v1.3 DEFERS: per-chain `KNOWN_SPENDERS_*` for UI label resolution in `lookupSpender` (the `(unknown spender — no prior interaction recorded)` fallback for non-Ethereum chains stays — surfaced in 08-04 SUMMARY as an accepted residual). Per-chain known-spender labels remain a v1.4+ ergonomics task.

**Why two tables not one** (DF-2 default):

- `KNOWN_SPENDERS_ETHEREUM` is a UI concern — labels that surface in the DECODED ARGS approve template's `spenderLabel:` slot. Phase 6 designed it; Phase 8 left it Ethereum-only deliberately.
- `CANONICAL_DISPATCH_TARGETS` is a SECURITY concern — addresses that pass the allowlist gate at preview time.

Sharing storage would couple the two concerns: every label table update would require re-evaluating allowlist semantics; every allowlist update would require considering whether to add a label. The Set-of-Address shape is also wrong for label storage (no label fields), so widening `KNOWN_SPENDERS_ETHEREUM` to per-chain + adding a separate Set view is more code than two parallel structures.

**Trade-off** (acknowledged):

- **DF-2 Option A — parallel `CANONICAL_DISPATCH_TARGETS` table (recommended):** clean separation of concerns; one table per purpose; future per-chain widening of `KNOWN_SPENDERS_*` doesn't have to coordinate with allowlist.
- **DF-2 Option B — widen `KNOWN_SPENDERS_*` per chain AND have `canonical-dispatch.ts` consume it:** less code duplication; but mixes UI + security concerns; future allowlist tightening would require touching the labels table.

Recommendation: A. See DF-2 in Design Forks for the locked decision rationale.

**Sources:**
- `src/config/contracts.ts` (in-repo) — per-chain getter helpers (`getAaveV3PoolAddress`, `getWethAddress`)
- `src/config/contracts.ts:248-310` (in-repo) — `KNOWN_SPENDERS_ETHEREUM` 11-entry table
- 1inch V6 router address verified at [https://portal.1inch.dev](https://portal.1inch.dev) — same `0x111111125421cA6dc452d289314280a0F8842A65` across Ethereum/Arbitrum/Polygon/Base/Optimism per Phase 6 SOT row
- LiFi diamond address verified at LiFi docs — same `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` across the same 5 chains
- 08-RESEARCH.md § Topic 7 (in-repo) — per-chain known-spender deferral rationale

### Topic 7: WC session-topic cross-check across every signing flow (Plan 09-05)

**Recommendation:** Additive `sessionTopicLast8: string | null` field on the `structuredContent` of `preview_send`, `send_transaction`, `pair_ledger_live_wait` responses. Currently `sessionTopicLast8` is in `get_ledger_status` response only (Plan 03-02). Pure addition — no FROZEN three-gate change. The `getStatus()` helper in `src/wallet/session-manager.ts` already computes the topic (verified at `src/tools/get_ledger_status.ts:43-59`); the additive surfacing reuses that computation.

**Surface inventory** (current vs new):

| Tool | Current `sessionTopicLast8` | After Plan 09-05 |
|------|----------------------------|------------------|
| `get_ledger_status` | YES (Plan 03-02) | YES — unchanged |
| `pair_ledger_live` | YES — surfaced in VERIFY-ON-DEVICE block (Plan 03-02) | YES — unchanged |
| `pair_ledger_live_wait` | YES — same as pair_ledger_live | YES — unchanged |
| `preview_send` | NO | YES — additive |
| `send_transaction` | NO | YES — additive (per-response, on the SUCCESS path; refusal paths don't surface it because no session may exist) |

**Why additive — not a new defensive check:** The cross-check IS the user looking at the response and comparing against Ledger Live → Settings → Connected Apps. The MCP server has NO way to verify the topic on the WC peer; the user is the verifier. The defense is making the topic VISIBLE on every signing-flow response, so the user can match without leaving the flow.

**Pitfall — demo mode:** No WC session exists in demo mode. `sessionTopicLast8` returns `null` in demo. The structuredContent field is `null`; the text payload omits a topic line (no "VERIFY WC TOPIC" block). Same shape as Plan 05-02's persona-based `from` resolution (demo branch SKIPS `getStatus()`).

**Pitfall — partial pairing (Phase 8 Plan 08-05):** `partiallyPaired: true` cases have a session topic (the WC session exists for some chains); the topic surfaces unchanged. The `partiallyPaired` flag is orthogonal to the topic.

**Wiring sketch** (in `src/tools/preview_send.ts`, additive after the existing structuredContent block):

```typescript
// NEW Plan 09-05: surface sessionTopicLast8 on the signing-flow response so
// the user can cross-check against Ledger Live → Settings → Connected Apps
// without leaving the preview_send response. NO new tool call — reuses the
// `status` (already resolved at preview_send.ts line 247-265 for real mode).
const sessionTopicLast8 = isDemoMode() ? null : status?.sessionTopicLast8 ?? null;

return {
  content: [{ type: "text", text }],
  structuredContent: {
    // ... existing fields ...
    sessionTopicLast8,  // NEW Plan 09-05
  },
};
```

**FROZEN-area discipline check:** `src/tools/send_transaction.ts` is FROZEN (Phase 4 three-gate). The additive surfacing must NOT touch any of the three gates. Plan 09-05 adds the field via Rule 1 (direct consequence) — the existing `getStatus()` is already called in `send_transaction.ts` to resolve the WC session topic for `signClient.request`; the additive field just SURFACES it back. Verify at execute time that the surfacing site is OUTSIDE the three-gate block.

**Sources:**
- `src/tools/get_ledger_status.ts:43-59` (in-repo) — current `sessionTopicLast8` surfacing
- `src/wallet/session-manager.ts:116` (in-repo) — `sessionTopicLast8: string` field on `LedgerStatus`
- `src/tools/pair_ledger_live_wait.ts` (in-repo) — existing topic surfacing in VERIFY-ON-DEVICE block

### Topic 8: `get_tx_verification` 15-min re-emit — RE-SPEC of existing tool, not new layer (Plan 09-05)

**Recommendation:** `get_tx_verification` ALREADY EXISTS — shipped in Plan 04-05 (PR #14). The current tool re-emits PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte cross-check + VERIFY BEFORE SIGNING + BROADCAST CONFIRMATION (for sent) + CANCELLED (for cancelled). Plan 09-05's "15-min handle re-emit" is a RE-SPEC, not a new tool. The v1.3 extension is bounded: ADD a `txJson` structuredContent field carrying the full unsigned tx (a context-evicted agent can re-relay the canonical view without re-running prepare).

**Current surface** (verified from `src/tools/get_tx_verification.ts:73-225`):

| Status | Text blocks emitted | structuredContent fields |
|--------|---------------------|-------------------------|
| prepared | PREPARE RECEIPT + "(preview has not run yet…)" | status, handle, chainId, to, valueWei, payloadFingerprint |
| previewed | PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK + 4BYTE + VERIFY BEFORE SIGNING | + previewToken, presignHash, selector, nonce, gas, fees, fourbyte |
| sent | All previewed blocks + BROADCAST CONFIRMATION (txHash + broadcastedAt) | + txHash, broadcastedAt |
| cancelled | All blocks reached + CANCELLED (cancelledAt) | + cancelledAt |

**v1.3 additions** (Plan 09-05 extension):

| What | Why | FROZEN-impact |
|------|-----|---------------|
| `txJson` structuredContent field | Context-evicted agent needs the canonical unsigned tx to re-relay; current re-emit gives blocks but not the tx-as-JSON | None — pure additive |
| `sessionTopicLast8` structuredContent field | Topic 7 — surface the WC topic for user cross-check | None — pure additive |
| `dispatchCheckResult` structuredContent field | Topic 6 — surface whether the prepared tx passed the canonical-dispatch allowlist at prepare-time (re-running the check at re-emit is cheap and re-anchors the user) | None — pure additive |

**Why NOT a new tool:** The Plan 04-05 tool ALREADY covers PREP-10 ("re-emit the verification block + tx JSON for 15 minutes after the original prepare call"). The "tx JSON" piece is the gap — current implementation returns block text + structured fields but doesn't bundle the unsigned tx as a coherent JSON object. The v1.3 extension closes that gap.

**TTL consideration:** Plan 04-01 set `HANDLE_TTL_MS = 15 * 60 * 1000` (15 minutes). Verified at `src/signing/handle-store.ts:21`. The existing TTL ALREADY covers v1.3's requirement; no change needed. Past-TTL → `HANDLE_EXPIRED` envelope, user re-runs `prepare_*` (handles are one-shot by design; re-prepare mints fresh `nonce` + `payloadFingerprint`).

**Tool description update** (Plan 09-05):

```typescript
// Source: src/tools/get_tx_verification.ts (Plan 09-05 — DESCRIPTION extension)
const DESCRIPTION = [
  // ... existing description preserved ...
  "v1.3 additions: structuredContent now carries `txJson` (full unsigned tx JSON, byte-equivalent to what preview_send would compute), `sessionTopicLast8` (WC session topic for Ledger Live cross-check), and `dispatchCheckResult` (whether the prepared tx.to passes the v1.3 canonical-dispatch allowlist).",
].join(" ");
```

**Sources:**
- `src/tools/get_tx_verification.ts` (in-repo) — full existing tool surface
- `src/signing/handle-store.ts:21` (in-repo) — `HANDLE_TTL_MS = 15 * 60 * 1000`
- Plan 04-05 SUMMARY — PREP-10 ship report
- REQUIREMENTS.md SEC-38 — "re-emits the VERIFY-BEFORE-SIGNING + tx JSON for 15 minutes" (the explicit tx-JSON-as-field requirement)

### Topic 9: FROZEN-area zero-diff verification (cross-cutting all Phase 9 plans)

**Recommendation:** Phase 9 ships entirely as NEW files + ADDITIVE modifications. Verified empirically against current source — the following files MUST be byte-frozen across Phase 9 plans:

| File | Reason FROZEN | Last touched |
|------|--------------|--------------|
| `src/signing/payload-fingerprint.ts` | PREP-03 preimage; Fixture A/D/E/F/G/H byte-identity anchor | Phase 4 (Plan 04-01); confirmed byte-frozen in Phases 5-8 |
| `src/signing/presign-hash.ts` | PREP-04 EIP-1559 RLP pre-sign; Fixture C byte-identity anchor | Phase 4 (Plan 04-01); byte-frozen in Phases 5-8 |
| `src/signing/handle-store.ts` state machine | Plan 04-01 prepared → previewed → sent/cancelled invariant | Phase 4 (Plan 04-01); byte-frozen in Phases 5-8 |
| `src/tools/send_transaction.ts` three gates | PREP-07 + PREP-08 schema gates + payloadFingerprint re-check | Phase 4 (Plan 04-04); byte-frozen in Phases 5-8 (Plan 08-02 explicitly carved Layer 2 placement to AVOID this file) |
| `src/clients/etherscan.ts` | Phase 7 Plan 07-04 surface; FROZEN by Phase 8 (08-02 deferred per-chain plumbing) | Phase 7 (Plan 07-04); byte-frozen in Phase 8 |
| `src/clients/fourbyte.ts` | Phase 4 Plan 04-05 surface; FROZEN since | Phase 4 (Plan 04-05); byte-frozen in Phases 5-8 |
| `src/protocols/aave-v3.ts` | Phase 7 Plan 07-02 / 07-03 protocol-decode surface | Phase 7; byte-frozen in Phase 8 |
| `src/protocols/erc20.ts` | Phase 6 Plan 06-02 decoder surface | Phase 6; byte-frozen in Phases 7-8 |
| `src/protocols/weth9.ts` | Phase 6 Plan 06-04 WETH9 surface | Phase 6; byte-frozen in Phases 7-8 |
| `src/signing/aave-health.ts` | Phase 7 Plan 07-02 HF math | Phase 7; byte-frozen in Phase 8 |
| `src/signing/amount.ts` | Phase 6 Plan 06-01 `parseAmountStrict` | Phase 6; byte-frozen in Phases 7-8 |
| `src/signing/simulation.ts` | Phase 6 Plan 06-02 DF-1 wide eth_call helper | Phase 6; byte-frozen in Phases 7-8 |
| Phase 8 chain-id assertion (Plan 08-02 Layer 2) — already in `preview_send.ts` lines 173-191 | Per-chain refusal gate | Phase 8 (Plan 08-02) — Phase 9 layers ABOVE this (Layer 0 dispatch-allowlist) without modifying |

**Phase 9 NEW files:**

- `src/security/canonical-dispatch.ts` (Plan 09-04) — `CANONICAL_DISPATCH_TARGETS` + `checkDispatchTarget` + `_canonicalDispatch` spy-affordance
- `src/security/skill-integrity.ts` (Plan 09-02) — `EXPECTED_SKILL_SHA256` + `checkSkillIntegrity` + `consumeSkillIntegrityNotice` + `_skillIntegrity` spy-affordance + `_resetSkillIntegrityForTesting` hook
- `src/tools/verify_tx_decode.ts` (Plan 09-05) — `verify_tx_decode` registered tool
- `src/tools/get_verification_artifact.ts` (Plan 09-03) — `get_verification_artifact` registered tool

**Phase 9 MODIFY (additive only):**

- `src/server.ts` — dispatcher-wrap for `VAULTPILOT NOTICE` (Plan 09-02; mirror of Plan 05-03's auto-demo NOTICE wrap)
- `src/tools/preview_send.ts` — Layer 0 dispatch-allowlist refusal BEFORE existing Layer 2 chain mismatch (Plan 09-04); additive `sessionTopicLast8` structuredContent field (Plan 09-05)
- `src/tools/send_transaction.ts` — additive `sessionTopicLast8` field on SUCCESS path; FROZEN three-gate UNCHANGED (Plan 09-05). Verify at execute time the additive surface is OUTSIDE the three gates.
- `src/tools/get_tx_verification.ts` — additive `txJson` + `sessionTopicLast8` + `dispatchCheckResult` structuredContent fields (Plan 09-05); no text-block changes
- `src/tools/pair_ledger_live_wait.ts` — additive `sessionTopicLast8` on response (may already exist — Plan 03-02 already surfaces topic in VERIFY-ON-DEVICE block; Plan 09-05 just confirms parity)
- `src/signing/blocks.ts` — additive `VAULTPILOT_NOTICE_TEMPLATE_MISSING` + `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` + `DISPATCH_TARGET_REFUSAL_TEMPLATE` + `PASTEABLE_BLOCK_TEMPLATE` (Plan 09-02 + 09-03 + 09-04 — append-only; existing templates byte-frozen)
- `src/signing/error-codes.ts` — additive `SKILL_INTEGRITY_FAILURE` + `DISPATCH_TARGET_REFUSED` + `DECODE_DIVERGENCE` (Plan 09-02 + 09-04 + 09-05 — 16 → 19 codes)
- `src/tools/register-all.ts` — +2 import lines for `verify_tx_decode.js` + `get_verification_artifact.js` (carved at the end of the existing import block to avoid Plan 08-04 / Plan 08-05 conflict; mirror of Phase 7 register-all carve discipline)
- `src/tools/get_vaultpilot_config_status.ts` — additive `skillIntegrity: { kind, path?, sha256? }` field (Plan 09-02 — surfaces the integrity state in the diagnostics tool for debugging; secret-safe by construction — no secret bytes pass through, only SHA-256 hex)

**Test surface additions** (Wave 0 gaps):

- `test/security-canonical-dispatch.test.ts` — per-chain allowlist coverage (5 chains × N rows = ~20 assertions) + checksum-round-trip + refusal-shape
- `test/security-skill-integrity.test.ts` — ok / missing / tampered states + dedup-per-session + reset hook
- `test/verify-tx-decode.test.ts` — happy paths for transfer/approve/withdraw/supply/aave-withdraw + divergence-per-field + decode-unsupported arm
- `test/get-verification-artifact.test.ts` — pasteableBlock byte-level fixture + sparse JSON shape + handle TTL + status branches
- `test/get-tx-verification.test.ts` (extend) — `txJson` + `sessionTopicLast8` + `dispatchCheckResult` field additions
- `test/preview-send.dispatch-allowlist.test.ts` — Layer 0 refusal at preview before Layer 2 chain check + native-send bypass + ESM spy round-trip
- `test/server.skill-notice.test.ts` — dispatcher-wrap NOTICE prepend (mirror of `test/server.auto-demo-notice.test.ts`)

**Sources:**
- `src/signing/payload-fingerprint.ts` (in-repo) — verified FROZEN through Phase 8
- `src/signing/handle-store.ts:21` (in-repo) — `HANDLE_TTL_MS` constant
- `src/tools/send_transaction.ts` (in-repo) — three-gate logic location for execute-time verification
- `08-RESEARCH.md` § Topic 9 (in-repo) — Phase 8's zero-diff finding; Phase 9 inherits

### Topic 10: Defense-in-depth layer enumeration — Phase 9 layers in the prepare → preview → send pipeline

Following Phase 8's Topic 10 table shape (mirror of `08-RESEARCH.md` § Topic 10 layer-table). Phase 9 adds 4 new layers; Phase 8's Layers 1-4 stay intact.

| Layer | Defense | Fires at | Trip condition | Fail-safe-default behavior |
|-------|---------|----------|----------------|---------------------------|
| **Layer −1 (NEW Phase 9)** | Skill Step 0 integrity self-check | Agent runtime (skill execution) BEFORE any verification step | `sha256sum SKILL.md ≠ EXPECTED_SKILL_SHA256` (pinned in MCP `INSTRUCTIONS`) | Agent emits `DO NOT SIGN. — skill integrity divergence` and halts. User re-installs the skill or upgrades the MCP. |
| **Layer 0 (NEW Phase 9)** | Server-side skill-installation probe + `VAULTPILOT NOTICE` block | MCP first tool dispatch of the session (lazy SHA-256 against cached state) | (a) skill not found at any probe path OR (b) computed SHA ≠ `EXPECTED_SKILL_SHA256` | Emit NOTICE block at TOP of first tool response (dedup per-session). User knows defense-in-depth is reduced. Refusal is INFORMATIONAL — does not block signing (the device hash match remains the trust anchor). |
| **Layer 0.5 (NEW Phase 9)** | Outer dispatch-target allowlist refusal | `preview_send` BEFORE Layer 2 chain check; ONLY for contract calls (`data !== "0x"`) | `record.tx.to ∉ CANONICAL_DISPATCH_TARGETS[chainId]` | Structured refusal with `DISPATCH_TARGET_REFUSED` errorCode 17; response lists the allowlist verbatim. User sees the unexpected target before approving anything. v1.3-covered protocols only; escape hatch (v2.4 `prepare_custom_call`) bypasses. |
| Layer 1 (Phase 8) | Schema-enum gate on `chain` arg | MCP dispatch — `AjvJsonSchemaValidator` (Plan 04-04 PREP-07) | Bogus chain name (not in `"ethereum" | "arbitrum" | "polygon" | "base" | "optimism"`) | Schema-validation refusal at protocol boundary; `McpError(InvalidParams)` — handler unreachable |
| Layer 2 (Phase 8) | Chain-name MISMATCH refusal at preview | `preview_send` (Plan 08-02) | `chainIdFromName(args.chain) ≠ record.tx.chainId` | Structured refusal with `CHAIN_ID_MISMATCH` errorCode 15 + `CHAIN_ID_MISMATCH_REFUSAL` block |
| Layer 3 (Phase 8) | Fingerprint drift detection at send | `send_transaction` (Plan 04-04 PREP-08 — FROZEN) | `computePayloadFingerprint(record.tx) ≠ record.payloadFingerprint` | Structured refusal with `PAYLOAD_FINGERPRINT_DRIFT` errorCode 6 + `prepare↔send drift detected` |
| **Layer 3.5 (NEW Phase 9)** | Server-side decode cross-check (`verify_tx_decode`) | OPTIONAL tool the agent calls between preview_send and send_transaction (agent-initiated, NOT auto-enforced) | Agent's `claimedDecode` ≠ server's independent decode via `_protocols.*` decoders | Discriminated-union response (`ok` / `divergence` / `decode-unsupported`). Divergence does NOT auto-block send — surfaces field-by-field diff; agent's decision-policy + skill enforcement determine halt-or-proceed. |
| **Layer 3.7 (NEW Phase 9)** | Out-of-band second-LLM verification (`get_verification_artifact`) | OPTIONAL tool the agent calls between preview_send and send_transaction (user-initiated, manual paste) | (no automated trip — manual user ritual) | User reads second LLM's decode, compares against this agent's narrative; halt-or-proceed is the user's decision. Defense against fully-coordinated agent compromise. |
| Layer 4 (always — out of MCP scope) | On-device clear-sign or blind-sign hash mismatch | Ledger device firmware at sign-time | `device's local presignHash ≠ MCP-emitted presignHash` (FROZEN — Phase 4 PREP-04) | Device REFUSES to sign; user reads device screen, sees mismatch, presses Reject |

**The Phase 9 layer additions are SEQUENTIAL DEFENSES, not orthogonal:** Layer −1 (skill self-check) catches a tampered skill; Layer 0 (server-side probe) catches a missing or tampered skill from the MCP side; Layer 0.5 (dispatch allowlist) catches off-protocol `to` addresses; Layer 3.5 (`verify_tx_decode`) catches decode lies; Layer 3.7 (`get_verification_artifact`) catches coordinated agent compromise. The fail-safe-default at each layer (refuse, halt, surface NOTICE) keeps the security guarantee "if anything in the chain is broken, the user sees a structured signal before being asked to confirm."

**The narrow-agent decode-lie threat is similar to the chain-mismatch threat from Phase 8:** the bytes are correctly bound, but the agent's *narrative* about the bytes differs from the bytes. The Phase 8 mitigation is the chain-name MISMATCH refusal + on-device `Network:` display; the Phase 9 mitigation is `verify_tx_decode`'s field-by-field diff + skill-side re-decode at Step 5 (Inv #11).

**Pitfall — Layer 0 dedup-per-session:** the NOTICE fires ONCE per process lifetime (per Plan 05-03's `consumeAutoDemoNotice` precedent). A long-lived MCP session where the user installs the skill mid-session won't see the OK transition — they'll just stop seeing the NOTICE on subsequent dispatches (and the cached state is OK from the install onwards). For test coverage, `_resetSkillIntegrityForTesting()` clears both the cached state AND the `noticeEmitted` flag.

**Pitfall — Layer 3.5 + 3.7 are agent-initiated:** Neither `verify_tx_decode` nor `get_verification_artifact` is automatically called by the MCP server during the existing prepare → preview → send pipeline. The agent must explicitly call them. The SKILL (`vaultpilot-preflight`) is what instructs the agent to call them via the Step 5 (Invariant #11) workflow. Without the skill installed, a non-cooperating agent could skip these checks entirely — Layer 0 (NOTICE) tells the user the skill isn't installed, and the user's discipline is the residual defense.

**Sources:**
- `08-RESEARCH.md` § Topic 10 (in-repo) — Phase 8 layer table; Phase 9 inherits and extends
- `src/tools/send_transaction.ts` (in-repo) — Layer 3 fingerprint-drift refusal (FROZEN)
- `src/tools/preview_send.ts:173-191` (in-repo) — Layer 2 chain-mismatch refusal placement
- `src/server.ts:153-161` (in-repo) — Layer 0 NOTICE dispatcher-wrap precedent (auto-demo NOTICE)

## SDK Probe Verdicts

| Package | Installed Version | Call Surface Used | Verdict |
|---------|-------------------|-------------------|---------|
| `viem` | 2.48.11 (verified Phase 7 / 8) | `decodeFunctionData` for re-decode in `verify_tx_decode` (same decoder `preview_send` uses via `_protocols.*` — no new dep), `getAddress` for EIP-55 round-trip in canonical-dispatch | **Adopt** — all decode operations consume the existing protocol modules; no new surface |
| `@modelcontextprotocol/sdk` | (verified Phase 1) | `Server` + `registerTool` for `verify_tx_decode` + `get_verification_artifact` registration | **Adopt** — same registration pattern as 13 existing tools |
| Node `crypto` (built-in) | Node ≥ 18.17 | `createHash("sha256").update(content).digest("hex")` for skill integrity SHA pin | **Adopt** — no new dep; built-in; sanity-checked at runtime |
| Node `fs/promises` (built-in) | Node ≥ 18.17 | `readFile` for skill file probe at `~/.claude/skills/vaultpilot-preflight/SKILL.md` | **Adopt** — no new dep; built-in; pattern mirrors `src/diagnostics/check.ts::readPackageVersion` |
| Node `os` (built-in) | Node ≥ 18.17 | `homedir()` for personal-scope skill probe path | **Adopt** — no new dep; built-in |
| Node `path` (built-in) | Node ≥ 18.17 | `join()` for probe path construction | **Adopt** — no new dep; built-in |
| `@anthropic/claude-code` / `@anthropic/skills-sdk` | NOT INSTALLED | NOT USED | **Skip** — no SDK for skill authoring; `SKILL.md` is plain markdown + YAML frontmatter consumed by the AGENT'S Claude Code runtime, not the MCP server |
| `simple-git` (or any git library) | NOT INSTALLED | NOT USED | **Skip** — Phase 9 doesn't programmatically clone the skill repo; users do the clone via the README one-liner. The MCP server only reads the SKILL.md file post-install |

## Assumptions Log

| ID | Claim | Section | Risk if Wrong |
|----|-------|---------|---------------|
| **A1** | Claude Code skill runtime probes `~/.claude/skills/<name>/SKILL.md` (personal scope) and `<cwd>/.claude/skills/<name>/SKILL.md` (project scope) — verified against documented "Where skills live" table. | Topic 1, 3 | Wrong → MCP server's probe paths miss real installations; users see VAULTPILOT NOTICE even when skill IS installed. Recovery: extend probe paths to cover plugin scope (`<plugin>/skills/`). [VERIFIED via code.claude.com/docs/en/skills, 2026-05-18] |
| **A2** | The `vaultpilot-preflight-skill` sister repo can ship a `SKILL.md` at the repo root; users `git clone <repo> ~/.claude/skills/vaultpilot-preflight` and the SKILL.md ends up at `~/.claude/skills/vaultpilot-preflight/SKILL.md` directly. | Topic 1 | Wrong → users need a manual `mv` after clone, friction on install. Recovery: README documents the right path; CI test asserts repo root structure matches `SKILL.md` at top level. [VERIFIED — git clone semantics put the repo contents at the target directory; no nesting if the target doesn't pre-exist.] |
| **A3** | The 1inch V6 router `0x111111125421cA6dc452d289314280a0F8842A65` and LiFi diamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` are deployed at the SAME address across Ethereum / Arbitrum / Polygon / Base / Optimism (CREATE2-style canonical-address-per-chain). | Topic 6 | Wrong → per-chain allowlist needs per-chain addresses for these routers; Plan 09-04 widens beyond a single inline literal. Recovery: extend `CANONICAL_DISPATCH_TARGETS` with per-chain rows. [VERIFIED for 1inch via portal.1inch.dev and KNOWN_SPENDERS_ETHEREUM row; LiFi via lifi.io docs cross-checked at planning time. CITED in `src/config/contracts.ts:KNOWN_SPENDERS_ETHEREUM`.] |
| **A4** | The MCP server can compute SHA-256 of the skill file at first dispatch (~1-5ms IO + ~0.1ms hash for a typical SKILL.md under 50KB) WITHOUT measurably affecting tool response latency. | Topic 3 | Wrong → latency complaints. Recovery: move to server-boot precompute (but blocks initialize handshake — Phase 5 anti-pattern). [ASSUMED — based on Node fs/promises typical latencies; verify-phase task to measure on cold-disk first-dispatch.] |
| **A5** | `process.cwd()` returns the MCP server's working directory which is typically the user's PROJECT root when the server is launched via `claude mcp add` (so `<cwd>/.claude/skills/` is the project-scope path). | Topic 3 | Wrong → project-scope probe path always misses (cwd is server install dir, not project root). Recovery: drop project-scope probe; document personal-scope only as v1.3 supported. [ASSUMED — Claude Code launches MCP servers with cwd = the project the user opened. Verify-phase task.] |
| **A6** | `viem.decodeFunctionData` is the SOT for `verify_tx_decode` server-side decode — agreement with the user's claimed decode is the cross-check; no need for a parallel re-implementation (e.g. raw ABI parsing). | Topic 5 | Wrong → divergence shape inherits viem's quirks (e.g. bigint vs string serialization, address checksum normalization). Recovery: normalize before compare (toString on bigint, getAddress on address). [VERIFIED — `src/protocols/erc20.ts:144` and `src/protocols/aave-v3.ts:144,162` already wrap viem's `decodeFunctionData`; reuse the existing wrappers.] |
| **A7** | The pasteableBlock format with explicit `>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>` markers survives Markdown rendering in chat clients (Claude desktop, Cursor, Claude Code CLI) without auto-formatting modifying the markers. | Topic 4 | Wrong → markers get rewritten or stripped, user can't reliably copy. Recovery: switch to fenced code block (triple-backtick) with the markers inside; the code-block convention is universally preserved. [ASSUMED — verify in each chat client during verify-phase. Backup plan: use a fenced code block instead of bare markers.] |
| **A8** | Second LLMs (fresh Claude / GPT / Gemini sessions) can reliably decode ERC-20 + Aave V3 calldata from scratch given the canned prompt. | Topic 4 | Wrong → second LLMs hallucinate decodes or refuse for safety. Recovery: include in the canned prompt explicit instructions for keccak self-recompute and ABI decoding; provide reference selectors for top operations. [ASSUMED — verify with 3-4 LLMs across the 5 covered actions during verify-phase.] |
| **A9** | The skill SHA-256 pin can be updated via a simple constant bump in `src/security/skill-integrity.ts` when the sister-repo ships a new tag; users see `VAULTPILOT NOTICE — tampered` with the new expected SHA and `git checkout` the new tag. | Topic 3 | Wrong → coordination overhead between MCP releases and skill releases creates friction. Recovery: document the bump-coordination procedure in the sister-repo README and the MCP CHANGELOG. [ASSUMED — same coordination discipline as `[SET-LEVEL ENUMERATION]` block (Plan 08-04's byte-frozen external contract); proven workable.] |
| **A10** | `process.cwd()`-based project-scope probe + `homedir()`-based personal-scope probe together cover ~95% of legitimate skill installations; plugin scope is v1.4+ scope. | Topic 1, 3 | Wrong → users on plugin-scope installs see VAULTPILOT NOTICE even with skill installed. Recovery: extend probe paths in v1.3.1. [ASSUMED — plugin scope is too new (per Anthropic skills docs, plugins are an emerging mechanism) to be a v1.3 target.] |
| **A11** | The user-facing description of `verify_tx_decode` does not encourage agents to call it on EVERY signing flow (which would 2x preview latency); the skill's Step 5 (Invariant #11) instructs WHEN to call it, and `disable-model-invocation: false` keeps the agent in control. | Topic 5, 10 | Wrong → over-calling burns RPC quota and adds latency. Recovery: tighten tool description routing. [ASSUMED — same routing-prompt discipline as `check_contract_security` (Plan 07-04, called only on user request).] |

## Design Forks (DF-N) — resolved at planning gate

Following Phase 6/7/8 pattern — researcher reasonable-call locks placement; surface to user ONLY genuine contradiction-of-prior-design forks. Phase 9 surfaces **two real forks** worth naming + locking explicitly. Both have defensible defaults and clear cost differences.

### DF-1: Sister-repo distribution — separate repo vs subdirectory of this repo?

**Options:**
- **Option A** *(recommended)*: Separate GitHub repo `vaultpilot-preflight-skill` (NEW). The MCP server has no build-time dependency; users `git clone` the skill repo separately to `~/.claude/skills/vaultpilot-preflight`.
- **Option B**: Subdirectory of this repo (`skill/SKILL.md` or `vaultpilot-preflight/SKILL.md`). The MCP repo ships both the server AND the skill source; users either clone the whole repo and symlink the skill subdir, or the MCP package bundles a `postinstall` script.
- **Option C**: Bundled inside the MCP package as a static file copied to `~/.claude/skills/` on `npm install`.

**Recommended default: Option A.**

**Why:**
- **Option A respects the trust-boundary discipline:** the skill is the load-bearing defense AGAINST a compromised MCP. If the MCP and the skill ship from the same source, a compromised release attack compromises BOTH simultaneously. Separate repos with separate maintainer-signed tags increase the attacker's cost (must compromise two release pipelines).
- **Option A respects Claude Code's idiomatic install pattern:** skills live at `~/.claude/skills/<name>/` independent of any specific MCP server; users can have the skill installed without VaultPilot ever being installed. Skills are first-class artifacts in Claude Code, not MCP extensions.
- **Option B couples the release cadences:** every skill update requires an MCP release (and vice-versa). DF-2 of Phase 9 mirrors `[SET-LEVEL ENUMERATION]` byte-frozen external contract discipline — the skill consumes byte-frozen MCP outputs; the MCP pins a SHA on the skill. Both can evolve, with coordination.
- **Option C breaks Claude Code conventions:** `~/.claude/skills/` is the USER'S configuration directory; an npm-installed package writing to it without explicit user action is invasive. The Claude Code docs explicitly say "Where you store a skill determines who can use it" — the user controls placement, not a package.

**Cost difference:**
- Option A: one extra `git clone` step at install; users on auto-mode that don't install miss the defense (Layer 0 NOTICE catches it).
- Option B: MCP repo size grows ~5-10KB; tighter coupling on release pipelines.
- Option C: invasive install behavior; user surprise; conflicts with existing `~/.claude/skills/` content.

**Tradeoffs:**
- Option A trusts users to install both artifacts; v1.3 ships with the assumption + the NOTICE-based detection of skill absence.
- Plan 09-01 ships the sister repo BOOTSTRAP (initial SKILL.md + Step 0..6 templates + repo scaffolding) — the orchestrator will checkpoint with the user at execute time for the actual `gh repo create` invocation against the user's namespace (per memory `feedback_auto_mode.md` — sister-repo creation is one of the few items that requires user-side action even under auto-mode).

### DF-2: Dispatch-allowlist storage — widen `KNOWN_SPENDERS_*` per chain, or parallel `CANONICAL_DISPATCH_TARGETS` table?

**Options:**
- **Option A** *(recommended)*: Parallel `CANONICAL_DISPATCH_TARGETS: Record<ChainId, ReadonlySet<Address>>` table in `src/security/canonical-dispatch.ts`. Sourced from existing per-chain getters (Aave, WETH) + inline literals for cross-chain canonical routers (1inch, LiFi).
- **Option B**: Widen `KNOWN_SPENDERS_ETHEREUM` to per-chain `KNOWN_SPENDERS_*` (5 chains) AND have `canonical-dispatch.ts` consume the union (`KNOWN_SPENDERS_ETHEREUM ∪ KNOWN_SPENDERS_ARBITRUM ∪ …`) plus filter by chain.
- **Option C**: Single `KNOWN_CANONICAL_TARGETS: Array<{ chainId, address, label, dispatchAllowed: boolean }>` super-table — labels + allowlist combined.

**Recommended default: Option A.**

**Why:**
- **Option A separates UI concerns from security concerns.** `KNOWN_SPENDERS_ETHEREUM` is a UI table (labels that surface in DECODED ARGS approve template); `CANONICAL_DISPATCH_TARGETS` is a security gate. Mixing storage couples updates — every label table modification would require re-evaluating allowlist semantics. The two tables can evolve at different cadences.
- **Option A respects the Phase 8 deferral.** 08-RESEARCH § Topic 7 line 1131 explicitly deferred per-chain `KNOWN_SPENDERS_*` to v1.3 (or later) on the rationale that the labels gap is minor (non-Ethereum spenders show `(unknown spender — no prior interaction recorded)` — surfaced as accepted residual in 08-04 SUMMARY). Widening the labels table in Phase 9 just to feed the allowlist is YAGNI; the security concern is independently addressable.
- **Option B mixes concerns and inherits the v1.2 labels gap.** Widening to per-chain labels brings the per-chain known-spender curation work (verification of each spender's canonical address on each chain, label cross-checks) into Phase 9 scope — that's Phase 10 / v1.4 scope per the ROADMAP. Phase 9 should ship the security gate, not the per-chain UI ergonomics.
- **Option C is too coupled and too YAGNI.** A unified super-table mixes label storage, allowlist membership, and per-chain disposition. Every consumer needs to filter; the filter shape is wrong for the Set-of-Address security primitive. Plan 09-04 picks the wrong abstraction.

**Cost difference:**
- Option A: ~50 lines of new code in `src/security/canonical-dispatch.ts` (table + getter + spy-affordance); consumes existing helpers.
- Option B: ~200 lines (widen 4 chain-specific tables + per-chain label verification + tests for label coverage) — pure overhead for the security goal.
- Option C: ~300 lines (table + per-chain filtering + label-vs-allowlist semantic anchoring + consumer migrations) — clean rewrite, broad blast radius.

**Tradeoffs:**
- Option A leaves the v1.2 UI gap (non-Ethereum spender labels) UNFIXED; documented as residual in 08-04 SUMMARY. Phase 9 doesn't widen that gap.
- The 1inch V6 + LiFi inline literals in Option A are technical debt — eventually a per-chain getter helper in `src/config/contracts.ts` would be cleaner. But those are deferred to v2.4 (where `prepare_custom_call` escape hatch ships and the per-chain DEX router tables become first-class SOT entries).

**No further forks.** All other placement choices have defensible reasonable-call defaults documented inline. Plan-checker may surface a third fork during their pass (especially around the `txJson` serialization shape for `get_tx_verification` — `bigint` → string vs `bigint` → hex); surface via AskUserQuestion at planning gate if needed.

## Project Constraints (from CLAUDE.md)

These directives carry through to every Phase 9 plan:

- **`src/config/contracts.ts`** is the SOT — Phase 9 CONSUMES the getters (`getAaveV3PoolAddress`, `getWethAddress`) — never inlines addresses for canonical contracts already in the SOT. The 1inch V6 + LiFi inline literals in `src/security/canonical-dispatch.ts` are explicitly outside the SOT (no existing getter; v2.4 widening scope).
- **Tool descriptions are agent routing prompts** — `verify_tx_decode` description names "use AFTER preview_send and BEFORE send_transaction; the agent passes its OWN decoded view"; `get_verification_artifact` description names "use … when the user wants an independent decode from a second LLM (catches coordinated-agent compromise)." Refusal messages name the canonical allowlist for `DISPATCH_TARGET_REFUSED`.
- **`prepare_*` always returns a handle** — Phase 9 doesn't touch prepare tools. The dispatch-allowlist fires at preview time, not prepare time (so the agent can call prepare with arbitrary `to` for diagnostic reasons; the user-facing surface is at preview).
- **`payloadFingerprint`** computed at prepare time, re-checked at send time — Phase 9 changes ZERO bytes of the preimage. The fingerprint is the LOAD-BEARING anchor `verify_tx_decode` + `get_verification_artifact` BOTH cite.
- **`previewToken` + `userDecision: "send"`** required on every `send_transaction` — FROZEN. Phase 9 adds NO new gate to send_transaction beyond the additive `sessionTopicLast8` field on the SUCCESS path.
- **No private key material crosses any boundary** — Phase 9 adds NO key handling. All operations are read + verify + refuse + emit.
- **Stderr for diagnostics, stdout for MCP protocol** — `src/security/skill-integrity.ts` warnings (e.g. unexpected probe failures beyond ENOENT) go through `src/diagnostics/logger.ts`.
- **Decimal-aware arithmetic** — `verify_tx_decode`'s amount comparison must handle decimal-string normalization (the agent might claim `"100.5"` while the bytes encode WEI `100500000`). Reuse `parseAmountStrict` (Phase 6) on the claimedDecode side to normalize before compare.
- **ESM spy-affordance indirection** — `src/security/canonical-dispatch.ts` exports `_canonicalDispatch = { checkDispatchTarget }`; `src/security/skill-integrity.ts` exports `_skillIntegrity = { checkSkillIntegrity }`. Tests `vi.spyOn` these indirections. Mirror of `_contracts` / `_protocols` / `_aaveProtocols` / `_simulation` patterns.
- **Cryptographic-binding fixtures pinned as hardcoded literals** — Phase 9 adds NO new fixture (cryptographic-binding chain FROZEN). `verify_tx_decode` tests anchor against existing Fixtures D/E/F/G/H from Phases 6/7 (transfer, approve, withdraw, supply, aave-withdraw).
- **Tool descriptions stay sharp** — per the "Documentation Style" CLAUDE.md rule (state each idea once, cut hedging adjectives). `verify_tx_decode` and `get_verification_artifact` descriptions distinguish their threat-model coverage clearly so the agent routes to the right tool.

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-30 | Companion skill repo ships with SKILL.md + integrity sentinel + Step 0 | sister-repo CI (out of MCP test scope) | (in sister repo: `bash test-sha256.sh` smoke) | ❌ Wave 0 — sister repo NEW |
| SEC-31 | MCP server pins skill SHA-256 in `instructions`; tamper/missing → NOTICE on first response | unit + integration | `npx vitest run test/security-skill-integrity.test.ts test/server.skill-notice.test.ts` | ❌ Wave 0 — NEW |
| SEC-32 | Skill encodes invariants #1/#2/#2.5/#5/#11 (#14 in 08-04) | sister-repo content test | (in sister repo: assert SKILL.md contains "Inv #1" through "Inv #14" headers) | ❌ Wave 0 — sister repo NEW |
| SEC-33 | Skill v0.x.0+ Step 0 mandatory pre-Invariant integrity self-check; halt on divergence | sister-repo manual content review | (in sister repo: human-read SKILL.md Step 0) | ❌ Wave 0 — sister repo NEW |
| SEC-34 | `get_verification_artifact({ handle })` returns sparse JSON + pasteableBlock + canned prompt | unit | `npx vitest run test/get-verification-artifact.test.ts` | ❌ Wave 0 — NEW |
| SEC-35 | Outer dispatch-target allowlist enforced server-side for Aave / WETH / 1inch / LiFi (5 chains) | unit | `npx vitest run test/security-canonical-dispatch.test.ts test/preview-send.dispatch-allowlist.test.ts` | ❌ Wave 0 — NEW |
| SEC-36 | WC session-topic cross-check surfaced in get_ledger_status (existing) + every signing flow | unit (extend) | `npx vitest run test/preview-send.test.ts test/send-transaction.test.ts -t "sessionTopicLast8"` | ✅ existing extended; new test cases per tool |
| SEC-37 | `verify_tx_decode({ handle, claimedDecode })` server-side cross-check; ok / divergence / decode-unsupported arms | unit | `npx vitest run test/verify-tx-decode.test.ts` | ❌ Wave 0 — NEW |
| SEC-38 | `get_tx_verification({ handle })` re-emits VERIFY-BEFORE-SIGNING + tx JSON for 15min | unit (extend) | `npx vitest run test/get-tx-verification.test.ts -t "txJson"` | ✅ existing extended for v1.3 fields |

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (verified via package.json `"test": "vitest run"`) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run --bail` |
| Full suite command | `npx vitest run` |

### Sampling Rate
- **Per task commit:** `npx vitest run path/to/affected/test.test.ts`
- **Per wave merge:** `npx vitest run` (full suite — Phase 8 baseline ~789 tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/security-skill-integrity.test.ts` — ok / missing / tampered state coverage + dedup-per-session + `_resetSkillIntegrityForTesting` hook (mirror of `src/diagnostics/notice.ts` test shape)
- [ ] `test/security-canonical-dispatch.test.ts` — per-chain allowlist coverage (5 chains × ~4 entries) + `checkDispatchTarget` ok / refused branches + EIP-55 round-trip + ESM spy round-trip via `_canonicalDispatch`
- [ ] `test/server.skill-notice.test.ts` — dispatcher-wrap prepend on first tool dispatch + dedup verification (mirror of `test/server.auto-demo-notice.test.ts`)
- [ ] `test/verify-tx-decode.test.ts` — happy paths (Fixtures D/E/F/G/H byte-identity) + 1-field-flip divergences (recipient typo, amount off-by-one, asset substitution, spender mismatch) + decode-unsupported arm for unknown selector
- [ ] `test/get-verification-artifact.test.ts` — pasteableBlock byte-level fixture + sparse JSON shape + status branches (prepared / previewed / sent / cancelled) + 15-min TTL inheritance + demo mode rejection (mirror of `get_tx_verification.test.ts`)
- [ ] `test/get-tx-verification.test.ts` (extend) — `txJson` structuredContent field + `sessionTopicLast8` field + `dispatchCheckResult` field for v1.3 spec
- [ ] `test/preview-send.dispatch-allowlist.test.ts` — Layer 0 refusal at preview BEFORE Layer 2 chain check + native-send bypass (data === "0x") + ESM spy round-trip + DISPATCH_TARGET_REFUSAL block byte-identity
- [ ] `test/preview-send.test.ts` (extend) — `sessionTopicLast8` additive field on success path
- [ ] `test/send-transaction.test.ts` (extend) — `sessionTopicLast8` additive field on success path; FROZEN three-gate UNCHANGED
- [ ] `test/get-vaultpilot-config-status.test.ts` (extend) — `skillIntegrity` field surfacing in diagnostics
- [ ] Sister repo `vaultpilot-preflight-skill/test/sha256.sh` (or equivalent) — CI sanity-check that the README's SHA-256 instruction matches the actual file content

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — MCP stdio transport |
| V3 Session Management | yes | WC v2 session-topic cross-check surfaced in every signing flow (Topic 7); existing PAIR-04 covers tamper-detection |
| V4 Access Control | yes | Schema-level enum + dispatch-target allowlist refusal (Topic 6); existing `userDecision` + `previewToken` gates (Phase 4 inherited) |
| V5 Input Validation | yes | JSON-schema `enum` on `chain` field (Phase 8 inherited); `getAddress` checksum guard on every Address arg in `canonical-dispatch.ts`; `claimedDecode` schema for `verify_tx_decode` |
| V6 Cryptography | yes | `payloadFingerprint` (Phase 4) + EIP-1559 RLP pre-sign hash (Phase 4) UNCHANGED; SHA-256 for skill integrity via Node `crypto` built-in (NOT hand-rolled); viem.decodeFunctionData (NOT hand-rolled ABI parser) |
| V8 Data Protection | yes | Skill integrity check guards against tampered SKILL.md (Topic 3); FROZEN cryptographic-binding chain protects against MCP-side payload swaps |

### Known Threat Patterns for {Phase 9 stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered SKILL.md (attacker modifies the skill to skip Step 0 self-check) | Tampering | MCP-side SHA-256 pin probe at first dispatch (Topic 3); `VAULTPILOT NOTICE` block surfaces divergence |
| Missing skill (user never installed; defense-in-depth reduced) | Information Disclosure (user not told the defense is missing) | `VAULTPILOT NOTICE — skill not installed` block on first dispatch (Topic 3); SECURITY.md residual-risk update |
| Off-protocol contract call (agent calls a contract not on the canonical allowlist) | Tampering / Spoofing | Layer 0 `DISPATCH_TARGET_REFUSED` refusal at preview (Topic 6); refusal lists the allowlist verbatim so user sees the unexpected target |
| Narrow agent decode lie (agent says "transfer 100 USDC to alice" but bytes encode "approve unlimited") | Spoofing | `verify_tx_decode` server-side cross-check (Topic 5); divergence-list shape surfaces field-by-field diff; Inv #11 via skill |
| Coordinated agent compromise (args + narrative both compromised; existing layers all bypassed) | Spoofing / Tampering | `get_verification_artifact` out-of-band second-LLM check (Topic 4); user-driven manual paste-and-compare ritual |
| Compromised WC peer (Ledger Live impostor relays a different tx than expected) | Tampering | `sessionTopicLast8` surfaced on every signing-flow response (Topic 7); user cross-checks against LL → Settings → Connected Apps |
| Stale skill version (user has v1.2.0 skill against v1.3.0 MCP, missing new invariants) | Information Disclosure | SHA-256 mismatch surfaces VAULTPILOT NOTICE — tampered (Topic 3); user knows to upgrade |
| Context-evicted agent loses canonical view | Repudiation (user can't verify what they're signing) | `get_tx_verification` re-emit with v1.3 `txJson` field (Topic 8); 15-min TTL window |
| Second-LLM refuses or hallucinates decode (defense-in-depth defense itself fails) | Denial of Service | Skill's Inv #11 + MCP's `verify_tx_decode` are independent layers; on-device clear-sign / blind-sign match remains the trust anchor |
| Tampered EXPECTED_SKILL_SHA256 constant in MCP build (attacker modifies the pin to accept their malicious skill) | Tampering | Build-time defense (source review + reproducible builds + sigstore signing — out of v1.3 scope; v1.4+ as DIST-* matures); v1.3 ships the gate, supply-chain hardening is v1.4 |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `crypto` (built-in) | SHA-256 skill integrity | ✓ | Node ≥ 18.17 | — |
| Node `fs/promises` (built-in) | Skill file probe | ✓ | Node ≥ 18.17 | — |
| Node `os.homedir()` (built-in) | Personal-scope skill path | ✓ | Node ≥ 18.17 | — |
| `viem` | decodeFunctionData re-use in verify_tx_decode | ✓ | 2.48.11 | — |
| `vitest` | All unit + integration tests | ✓ | (per package.json) | — |
| `@modelcontextprotocol/sdk` | New tool registration | ✓ | (per package.json) | — |
| Claude Code skills runtime | Agent-side skill consumption | (assumed installed where agent runs) | n/a | NOTICE block surfaces if skill not installed |
| `gh` CLI (for `gh repo create vaultpilot-preflight-skill`) | Plan 09-01 sister-repo bootstrap | required for execute | n/a | Documented as user-side checkpoint per `feedback_auto_mode.md` |

**No missing dependencies block planning.** Sister-repo creation via `gh repo create` is the one user-side checkpoint at execute time (per the auto-mode memory entry — this is one of the rare cross-cutting actions that requires user-side confirmation even under auto-mode).

## Open Questions (RESOLVED)

All resolved at planning gate per Phase 5/6/7/8 reasonable-call discipline. Items deferred to verify-phase listed in Assumptions Log (A4 lazy-SHA latency, A5 process.cwd() semantics in MCP-launched contexts, A7 markdown-marker preservation, A8 second-LLM decode reliability, A10 plugin-scope coverage).

## Files Phase 9 Will Touch (preliminary scope inventory)

For the planner's mental model — confirm with pattern-mapper.

**New files (cross-cutting / per-plan):**
- `src/security/canonical-dispatch.ts` (Plan 09-04) — per-chain allowlist + `checkDispatchTarget` + `_canonicalDispatch` spy-affordance
- `src/security/skill-integrity.ts` (Plan 09-02) — SHA-256 pin + probe + `consumeSkillIntegrityNotice` + `_skillIntegrity` spy-affordance + reset hook
- `src/tools/verify_tx_decode.ts` (Plan 09-05) — server-side decode cross-check
- `src/tools/get_verification_artifact.ts` (Plan 09-03) — second-LLM pasteableBlock emission
- `test/security-canonical-dispatch.test.ts` — Plan 09-04 coverage
- `test/security-skill-integrity.test.ts` — Plan 09-02 coverage
- `test/server.skill-notice.test.ts` — dispatcher-wrap coverage
- `test/verify-tx-decode.test.ts` — Plan 09-05 happy + divergence + unsupported arms
- `test/get-verification-artifact.test.ts` — Plan 09-03 sparse JSON + pasteableBlock shape
- `test/preview-send.dispatch-allowlist.test.ts` — Plan 09-04 Layer 0 refusal at preview

**New repo (out-of-codebase):**
- `vaultpilot-preflight-skill/` — sister GitHub repo (`gh repo create` at execute time); contains `SKILL.md` + `README.md` + integrity-sentinel constant + Step 0..6 invariants
- `vaultpilot-preflight-skill/test/` — sister-repo CI tests (SHA-256 sanity, content presence)

**Extended files (additive only):**
- `src/server.ts` — dispatcher-wrap `VAULTPILOT NOTICE` block prepend (mirror of Plan 05-03 auto-demo NOTICE); zero changes to existing schema gate / handler dispatch
- `src/tools/preview_send.ts` — Layer 0 dispatch-allowlist refusal BEFORE existing Layer 2 chain check; additive `sessionTopicLast8` structuredContent field
- `src/tools/send_transaction.ts` — additive `sessionTopicLast8` field on SUCCESS path; FROZEN three-gate UNCHANGED (assert via execute-time diff)
- `src/tools/get_tx_verification.ts` — additive `txJson` + `sessionTopicLast8` + `dispatchCheckResult` structuredContent fields
- `src/tools/pair_ledger_live_wait.ts` — confirm/add `sessionTopicLast8` field (likely already present; verify parity)
- `src/tools/get_vaultpilot_config_status.ts` — additive `skillIntegrity: { kind, path?, sha256? }` field (secret-safe)
- `src/signing/blocks.ts` — additive `VAULTPILOT_NOTICE_TEMPLATE_MISSING` + `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` + `DISPATCH_TARGET_REFUSAL_TEMPLATE` + `PASTEABLE_BLOCK_TEMPLATE` (append-only; existing templates byte-frozen)
- `src/signing/error-codes.ts` — additive `SKILL_INTEGRITY_FAILURE` + `DISPATCH_TARGET_REFUSED` + `DECODE_DIVERGENCE` (16 → 19 codes)
- `src/tools/register-all.ts` — +2 import lines (verify_tx_decode + get_verification_artifact); carved to avoid Plan 08-04 / Plan 08-05 conflict
- `test/get-tx-verification.test.ts` (extend) — `txJson` + `sessionTopicLast8` + `dispatchCheckResult` v1.3 field additions
- `test/preview-send.test.ts` (extend) — `sessionTopicLast8` field on success
- `test/send-transaction.test.ts` (extend) — `sessionTopicLast8` field on success; verify three-gate unchanged
- `test/get-vaultpilot-config-status.test.ts` (extend) — `skillIntegrity` diagnostics
- `SECURITY.md` (extend) — update Residual Risks section: compromised-MCP risk is no longer "open" (closed by v1.3 skill — note conditional on skill being installed); add coordinated-agent and narrow-agent threat closures (with their respective layers + residual)

**Not touched (FROZEN — assert zero diff in every plan's success_criteria):**
- `src/signing/payload-fingerprint.ts` — preimage shape invariant
- `src/signing/presign-hash.ts` — EIP-1559 RLP unchanged
- `src/signing/handle-store.ts` — state machine + TTL unchanged
- `src/tools/send_transaction.ts` THREE-GATE block (lines covering PREP-07 schema gate + PREP-08 fingerprint re-check + userDecision check) — additive surfacing outside this block only
- `src/clients/etherscan.ts` — Phase 7 surface FROZEN
- `src/clients/fourbyte.ts` — Phase 4 surface FROZEN
- `src/protocols/aave-v3.ts` — Phase 7 decoder FROZEN
- `src/protocols/erc20.ts` — Phase 6 decoder FROZEN
- `src/protocols/weth9.ts` — Phase 6 decoder FROZEN
- `src/signing/aave-health.ts` — Phase 7 HF math FROZEN
- `src/signing/amount.ts` — Phase 6 parseAmountStrict FROZEN
- `src/signing/simulation.ts` — Phase 6 wide-simulation helper FROZEN
- `src/wallet/session-manager.ts` — Phase 8 multi-chain widening FROZEN (Phase 9 only READS `getStatus()`)
- `src/chains/registry.ts` — Phase 8 per-chain registry FROZEN
- `src/config/contracts.ts` — Phase 8 ContractsForChain surface FROZEN (Phase 9 only CONSUMES getters; no widening)

## Sources

### Primary (HIGH confidence)
- [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills) — canonical SKILL.md frontmatter shape, `Where skills live` table, allowed-tools / disable-model-invocation semantics (Topic 1, 3)
- [anthropics/skills GitHub](https://github.com/anthropics/skills) — Anthropic's reference skill examples (Topic 1)
- `./SECURITY.md` (in-repo) — Compromise Model + Residual Risks + invariant cross-references (Topic 2)
- `./CLAUDE.md` (in-repo) — Architecture diagram + Conventions + FROZEN-area discipline (cross-cutting)
- `./PROJECT.md` Key Decisions table — "Defer companion skill (`vaultpilot-preflight`) to v1.3" decision (Topic 2)
- `src/tools/get_tx_verification.ts` (in-repo) — existing 15-min handle re-emit surface (Topic 8)
- `src/signing/handle-store.ts:21` (in-repo) — `HANDLE_TTL_MS = 15 * 60 * 1000` (Topic 8)
- `src/tools/check_contract_security.ts` (in-repo) — 5-arm discriminated union analog (Topic 5)
- `src/protocols/{erc20,aave-v3,weth9}.ts` (in-repo) — decoder shapes for `verify_tx_decode` reuse (Topic 5)
- `src/config/contracts.ts` (in-repo) — per-chain getter helpers + `KNOWN_SPENDERS_ETHEREUM` (Topic 6)
- `src/diagnostics/notice.ts` + `src/server.ts:153-161` (in-repo) — dispatcher-wrap precedent for NOTICE blocks (Topic 3)
- `src/tools/get_ledger_status.ts` + `src/wallet/session-manager.ts` (in-repo) — existing `sessionTopicLast8` surfacing (Topic 7)
- `08-RESEARCH.md` § Topic 7 + § Topic 9 (in-repo) — Phase 8 per-chain known-spender deferral + chain-id flow through cryptographic chain (Topic 6, 9)

### Secondary (MEDIUM confidence)
- [Agent Skills open standard](https://agentskills.io) — cross-tool SKILL.md spec reference (Topic 1)
- [Claude Skills Marketplace — BrightCoding 2026-04](https://www.blog.brightcoding.dev/2026/04/26/claude-skills-marketplace-the-essential-plugin-hub-for-developers) — installation patterns (clone vs marketplace)
- 1inch portal (portal.1inch.dev) — V6 router address `0x111111125421cA6dc452d289314280a0F8842A65` cross-checked against `KNOWN_SPENDERS_ETHEREUM` row 3 (Topic 6)
- LiFi docs — Diamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` cross-checked against `KNOWN_SPENDERS_ETHEREUM` row 2 (Topic 6)

### Tertiary (LOW confidence — flagged for verify-phase)
- A4 (lazy-SHA latency on cold-disk first dispatch) — needs empirical measurement
- A5 (`process.cwd()` semantics in `claude mcp add`-launched contexts) — needs empirical confirmation
- A7 (pasteableBlock markdown-marker preservation across chat clients) — needs cross-client testing
- A8 (second-LLM decode reliability across 3-4 LLMs) — needs verify-phase smoke
- A10 (plugin-scope coverage at `<plugin>/skills/` path) — v1.3.1 / v1.4 deferral

## Metadata

**Confidence breakdown:**
- Claude Code skill structure + installation flow (Topic 1): HIGH — empirically verified against code.claude.com/docs/en/skills 2026-05-18
- Invariant enumeration + skill encodings (Topic 2): HIGH — cross-referenced against SECURITY.md + CLAUDE.md + REQUIREMENTS.md SEC-32
- SHA-256 pin mechanics + dispatcher-wrap (Topic 3): HIGH — mirror of Plan 05-03 auto-demo NOTICE; Node crypto sanity-checked at runtime
- `get_verification_artifact` pasteableBlock shape (Topic 4): MEDIUM — second-LLM decode reliability assumed; markdown-marker preservation assumed; both verify-phase tasks
- `verify_tx_decode` semantics (Topic 5): MEDIUM-HIGH — decoder reuse is clean (single SOT in `src/protocols/*.ts`); divergence-list shape mirrors `check_contract_security`'s 5-arm but tighter
- Dispatch-target allowlist (Topic 6): HIGH — per-chain addresses cross-verified for Aave + WETH via existing getters; 1inch + LiFi inline literals cross-checked against `KNOWN_SPENDERS_ETHEREUM`
- WC session-topic cross-check (Topic 7): HIGH — pure additive surfacing; FROZEN three-gate untouched
- `get_tx_verification` re-spec (Topic 8): HIGH — existing tool surface verified line-by-line; v1.3 additions are additive structuredContent fields
- FROZEN-area zero-diff (Topic 9): HIGH — empirically verified against current source tree; mirrors Phase 8 discipline
- Defense-in-depth layer enumeration (Topic 10): HIGH — Phase 8 Topic 10 inheritance + 4 new layers with explicit trip conditions

**Research date:** 2026-05-18
**Valid until:** 2026-06-15 (estimate — Claude Code skills runtime + viem + Node crypto all stable; if Anthropic ships skill marketplace v2 or plugin-scope changes the probe-path semantics, revisit Topic 1)
