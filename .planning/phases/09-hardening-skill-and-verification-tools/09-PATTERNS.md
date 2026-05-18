# Phase 9: Hardening — skill + 3 verification tools + dispatch allowlist — Pattern Map

**Mapped:** 2026-05-18
**Phase scope:** Plans 09-01 (sister-repo skill bootstrap), 09-02 (skill-integrity probe + VAULTPILOT NOTICE dispatcher-wrap), 09-03 (`get_verification_artifact`), 09-04 (canonical-dispatch allowlist), 09-05 (`verify_tx_decode` + `get_tx_verification` re-spec + WC session-topic surfacing)
**Files in scope:** 4 NEW src files + 1 NEW src directory (`src/security/`) + 7 additive src modifications + 7 NEW test files + ~5 extended tests + 1 sister-repo (out-of-codebase)
**Analogs found:** every NEW file has a strong in-tree analog (Plan 05-03 dispatcher-wrap for skill-integrity NOTICE; Plan 07-04 discriminated-union shape for `verify_tx_decode`; Plan 04-05 handle-lookup tool for `get_verification_artifact`; Plan 06-03 SOT-curated-table for `CANONICAL_DISPATCH_TARGETS`)

## Executive Summary — phase shape is ADDITIVE LAYERING with ZERO FROZEN-area diff

Phase 9 is fundamentally different in carve from Phases 6/7/8:

- **Phase 6** was mechanical-clone (sibling `prepare_*` tools).
- **Phase 7** was protocol-extension (sibling `protocols/`, sibling SOT slots).
- **Phase 8** was structural-extension (enum widening, chain-arg threading across many files).
- **Phase 9** is **additive layering** — 4 NEW layers (−1 skill self-check, 0 NOTICE, 0.5 dispatch allowlist, 3.5 decode cross-check) ride on top of the cryptographic-binding chain WITHOUT touching it.

Dominant primitives:

- **Two NEW security modules** in NEW `src/security/` directory (first occupant of the long-planned `## Architecture` shelf). `skill-integrity.ts` reads SKILL.md and SHA-256s it; `canonical-dispatch.ts` exposes a per-chain `ReadonlySet<Address>` gate.
- **Two NEW MCP tools** (`verify_tx_decode`, `get_verification_artifact`) — `get_tx_verification` is PRE-EXISTING (PR #14, Plan 04-05) and gets an ADDITIVE structuredContent extension (`txJson` + `sessionTopicLast8` + `dispatchCheckResult`), no text-block changes.
- **Three NEW error codes** (`SKILL_INTEGRITY_FAILURE`, `DISPATCH_TARGET_REFUSED`, `DECODE_DIVERGENCE`) — 16 → 19 entries in the locked union.
- **One dispatcher-wrap addition** at `src/server.ts` lines 153-161 region (mirror of Plan 05-03's auto-demo NOTICE prepend; same dedup-per-session shape).
- **One ADDITIVE Layer 0.5 refusal** at `src/tools/preview_send.ts` — fires BEFORE the existing Layer 2 chain-mismatch (lines 173-191); only when `record.tx.data !== "0x"` (native sends bypass).
- **Pure-additive `sessionTopicLast8` field** on `preview_send`, `send_transaction`, `get_tx_verification` structuredContent (already present on `get_ledger_status` + `pair_ledger_live_wait`).

Implications for executor coordination:

- **FROZEN-area discipline empirically verified.** `payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine + 15-min TTL, `send_transaction.ts` three gates, ALL `src/protocols/*.ts` decoders, ALL `src/clients/*.ts` — zero-diff in every Phase 9 plan's `<success_criteria>`. Plan-checker dimension: any diff to these files in Phase 9 fails review.
- **No SDK probe needed for skill authoring.** SKILL.md is plain markdown + YAML frontmatter; consumed by the AGENT'S Claude Code runtime, NOT the MCP server. The MCP only reads the file and SHA-256s it via Node `crypto.createHash` (built-in, no new dep).
- **Sister repo is execute-time concern.** `gh repo create` against the user namespace is a user-side checkpoint per `feedback_auto_mode.md` discipline. Pattern-mapper notes the SKILL.md structure here; planner stages the actual repo creation as a user-checkpoint step.

## 1. File-to-Analog Mapping

### New files

| New File | Role | Data Flow | Closest Analog | Match Quality | Bounded Diffs |
|---|---|---|---|---|---|
| `src/security/skill-integrity.ts` (Plan 09-02) | security / config-resolution | request-response (lazy memoized SHA + IO read) | `src/diagnostics/notice.ts` (dedup-per-session NOTICE) + `src/diagnostics/check.ts::readPackageVersion` (lazy fs/promises IO via `await import` pattern) | exact (NOTICE dedup) + role-match (lazy file IO) | `EXPECTED_SKILL_SHA256` constant; `PROBE_PATHS` two-entry array; `SkillIntegrityState` 3-arm discriminated union (`ok` / `missing` / `tampered`); `checkSkillIntegrity()` memoized once-per-session; `consumeSkillIntegrityNotice(state)` dedup-once-per-session; `_skillIntegrity = { checkSkillIntegrity }` spy-affordance; `_resetSkillIntegrityForTesting()` test hook |
| `src/security/canonical-dispatch.ts` (Plan 09-04) | security / config (curated allowlist) | constants + lookup | `src/config/contracts.ts:248-310` (`KNOWN_SPENDERS_ETHEREUM` curated `Record<Address, label>`) | role-match — same SOT-table-with-getter shape, different value type (`ReadonlySet<Address>` for set-membership instead of `Record<Address, Label>` for label-lookup) | `Record<ChainId, ReadonlySet<Address>>` instead of `Record<ChainId, Record<Address, Label>>`; sourced from existing `getAaveV3PoolAddress(chainId)` + `getWethAddress(chainId)` getters + 2 inline literals (1inch V6, LiFi diamond — same address per chain per A3); `checkDispatchTarget(chainId, to): DispatchCheckResult` 2-arm union (`ok` / `refused`); `_canonicalDispatch = { checkDispatchTarget }` spy-affordance |
| `src/tools/verify_tx_decode.ts` (Plan 09-05) | tool (defensive read) | request-response + protocol decode | `src/tools/check_contract_security.ts` (5-arm discriminated union surfacing + INVALID_INPUT envelope shape + tool-DESCRIPTION shape) | role-match — same discriminated-union, fewer arms (3 vs 5); same `makeStructuredError` envelope discipline | `claimedDecode: { to, action, args }` input shape; reuses EXISTING `_protocols.decodeErc20Call` + `_aaveProtocols.decodeAaveV3Call` (Phase 6/7 SOT — NO parallel decoder); 3-arm response (`ok` / `divergence: Divergence[]` / `decode-unsupported`); per-action comparison rules (`transfer` / `approve` / `withdraw` / `aave-supply` / `aave-withdraw`); `parseAmountStrict` reuse for decimal-string-vs-WEI normalization |
| `src/tools/get_verification_artifact.ts` (Plan 09-03) | tool (handle re-emit) | request-response | `src/tools/get_tx_verification.ts` (handle-lookup + status-aware re-emit + isDemoMode-first + lookup-via-handle-store + 15-min TTL inheritance) | exact — same scaffolding shape, different block payload (pasteableBlock for second-LLM instead of PREPARE RECEIPT + LEDGER + AGENT TASK + 4byte) | NO 4byte fetch (deterministic from `record`); sparse JSON structuredContent (`{ to, valueWei, data, chainId, payloadFingerprint, presignHash, selector }`); `PASTEABLE_BLOCK_TEMPLATE` substitution with `>>>>` / `<<<<` markers; status-branch coverage mirrors get_tx_verification |

### Modified (existing) files — additive only

| Modified File | Role | Data Flow | Self-Extension Shape | Bounded Diffs |
|---|---|---|---|---|
| `src/server.ts` (Plan 09-02) | dispatcher | request-handler wrap | Mirror of lines 153-161 auto-demo NOTICE wrap; appended AFTER existing auto-demo block, BEFORE `return result` | `const integrityState = await _skillIntegrity.checkSkillIntegrity(); const notice = consumeSkillIntegrityNotice(integrityState); if (notice !== null) return { ...result, content: [{ type: "text", text: notice }, ...result.content] };` — 5 lines; mirror of `isAutoDemo()` + `consumeAutoDemoNotice()` block already at server.ts:153-161 |
| `src/tools/preview_send.ts` (Plan 09-04 + 09-05) | tool (preview) | trust pipeline | TWO additive insertions: (a) Layer 0.5 dispatch-allowlist refusal at TOP of try-block (BEFORE existing handle lookup at line 144 — actually AFTER lookup since we need `record.tx.chainId` + `record.tx.to`; pattern-mapper recommends placement BETWEEN existing handle-lookup (line 144-156) and existing Layer 2 chain-mismatch (line 173-191) — that gives us `record` for both checks); (b) additive `sessionTopicLast8: status?.sessionTopicLast8 ?? null` on success structuredContent at line 559-581 | NEW imports: `_canonicalDispatch`, `DISPATCH_TARGET_REFUSAL_TEMPLATE`; NEW refusal block fires only when `record.tx.data !== "0x"` (native sends bypass per Topic 6 lock); existing FROZEN behavior intact |
| `src/tools/send_transaction.ts` (Plan 09-05) | tool (send) | trust pipeline | Single ADDITIVE field on SUCCESS path only (lines 524-530 region) — `sessionTopicLast8` from `getStatus()` (already called for `signClient.request` upstream in this handler — see existing wallet pairing block). FROZEN three gates UNCHANGED. | Add `sessionTopicLast8` field to the success `structuredContent` block at line 524-530. Asserted via Plan 09-05 success_criteria: `git diff src/tools/send_transaction.ts` shows ONLY the additive line within the success-path structuredContent block (NOT inside the three-gate region at PREP-07/PREP-08/userDecision). |
| `src/tools/get_tx_verification.ts` (Plan 09-05) | tool (re-emit) | request-response | THREE additive structuredContent fields appended to lines 203-222 region: `txJson`, `sessionTopicLast8`, `dispatchCheckResult` | Build `txJson` from `record.tx` (bigint → string for JSON safety; mirror of `gas: pinned.gas.toString()` discipline at line 214); call `_canonicalDispatch.checkDispatchTarget(record.tx.chainId, record.tx.to)` if `record.tx.data !== "0x"` else `{ kind: "not-applicable" }`; pull `sessionTopicLast8` from `getStatus()` (NEW import); NO text-block change (V Verify Before Signing block is already at line 172) |
| `src/tools/pair_ledger_live_wait.ts` (Plan 09-05 — verify parity, likely no change) | tool (wait) | wallet | ALREADY surfaces `sessionTopicLast8` (verified at file:95-110). Plan 09-05 confirms parity; no source edit unless test reveals gap. | None expected — confirmation only. |
| `src/tools/get_vaultpilot_config_status.ts` (Plan 09-02) | tool (diagnostic) | request-response | Additive `skillIntegrity: { kind: "ok" \| "missing" \| "tampered", path?: string, sha256?: string }` field on the diagnostic structuredContent | Calls `_skillIntegrity.checkSkillIntegrity()` (memoized — no IO cost on the diagnostic surface); discriminated-union returned verbatim minus internal-only fields (no `computed` / `expected` on the diagnostic — secret-safe by surfacing kind + path only; SHA bytes on `ok` arm only) |
| `src/signing/blocks.ts` (Plans 09-02 + 09-03 + 09-04) | format SOT | static templates | APPEND-ONLY (Phase 4 + Phase 6 + Phase 7 + Phase 8 templates all stay byte-frozen — pattern-mapper verified the Phase 7 comment block at lines 477-492 + Phase 8 Plan 08-04 SET_LEVEL block at lines 495-540 as precedent for additive layering) | NEW templates: `VAULTPILOT_NOTICE_TEMPLATE_MISSING`, `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` (Plan 09-02), `DISPATCH_TARGET_REFUSAL_TEMPLATE` (Plan 09-04), `PASTEABLE_BLOCK_TEMPLATE` (Plan 09-03). NO existing template touched. Format-fanout-sentinel: one block, one home; tests import each const byte-identically. |
| `src/signing/error-codes.ts` (Plans 09-02 + 09-04 + 09-05) | format SOT | union extension | Add 3 entries to the locked union (16 → 19 codes). NO existing entry removed. Producer-map comment block extended per Phase 8 precedent. | New entries: `SKILL_INTEGRITY_FAILURE` (Plan 09-02), `DISPATCH_TARGET_REFUSED` (Plan 09-04), `DECODE_DIVERGENCE` (Plan 09-05). Plan-checker dimension: exhaustive `switch` over `ErrorCode` in any consumer breaks at compile time — surfaces omission before merge (per Phase 4 lock at error-codes.ts:1-9). |
| `src/tools/register-all.ts` (Plans 09-03 + 09-05) | bootstrap | side-effect imports | +2 import lines for `verify_tx_decode.js` + `get_verification_artifact.js`. Carved to avoid Phase 8 line-region overlap (Plan 08-04's adds were at lines 6-7 in the read-tool group). | Insert BOTH new lines AFTER `import "./get_tx_verification.js";` at line 25 in the existing import list — keeps tx-verification cluster contiguous; no collision with Plan 08-04's reads-group insertions at lines 6-7 |

### Out-of-codebase (sister repo)

| Repo / File | Role | Notes |
|---|---|---|
| `vaultpilot-preflight-skill/` (NEW GitHub repo via `gh repo create`) | skill (agent-side) | `gh repo create` is execute-time user checkpoint per `feedback_auto_mode.md`. Pattern-mapper documents the structure; planner stages the actual create. |
| `vaultpilot-preflight-skill/SKILL.md` | skill content | YAML frontmatter (`description`, `allowed-tools: Bash(sha256sum *) Bash(shasum *)`, `disable-model-invocation: false`) + Step 0 mandatory integrity self-check + Steps 1-6 encoding invariants #1, #2, #2.5, #5, #11, #14. Step 0 hash format: `sha256sum SKILL.md` vs pinned MCP-emitted `EXPECTED_SKILL_SHA256`. |
| `vaultpilot-preflight-skill/README.md` | install docs | One-liner `git clone https://github.com/<user>/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight && cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0`. Personal-scope install path is primary; project-scope is secondary. |
| `vaultpilot-preflight-skill/test/sha256.sh` | sister-repo CI | Smoke test asserting the README's SHA-256 instruction matches the actual SKILL.md content. Out of MCP test scope. |

### NOT TOUCHED (FROZEN — zero-diff asserted by every Plan's `<success_criteria>`)

| File | Reason FROZEN | Last touched |
|---|---|---|
| `src/signing/payload-fingerprint.ts` | PREP-03 preimage; Fixtures A/D/E/F/G/H byte-identity anchor | Phase 4 (Plan 04-01) |
| `src/signing/presign-hash.ts` | PREP-04 EIP-1559 RLP; Fixture C byte-identity anchor | Phase 4 (Plan 04-01) |
| `src/signing/handle-store.ts` | State machine + 15-min `HANDLE_TTL_MS` (line 21) | Phase 4; PrepareArgs widened in Phase 6 (additive only) |
| `src/tools/send_transaction.ts` THREE-GATE region | PREP-07 schema gate + PREP-08 fingerprint re-check + userDecision check | Phase 4 (Plan 04-04); Phase 9 adds `sessionTopicLast8` OUTSIDE this region (success-path structuredContent at lines 524-530) |
| `src/clients/etherscan.ts` | Phase 7 surface | Phase 7 (Plan 07-04) |
| `src/clients/fourbyte.ts` | Phase 4 surface | Phase 4 (Plan 04-05) |
| `src/protocols/aave-v3.ts` | Decoder surface (`_aaveProtocols.decodeAaveV3Call` reused by verify_tx_decode) | Phase 7 |
| `src/protocols/erc20.ts` | Decoder surface (`_protocols.decodeErc20Call` reused) | Phase 6 |
| `src/protocols/weth9.ts` | Selector + decoder | Phase 6 |
| `src/signing/aave-health.ts` | HF math | Phase 7 |
| `src/signing/amount.ts` | `parseAmountStrict` (reused by verify_tx_decode for decimal normalization — read-only consumer) | Phase 6 |
| `src/signing/simulation.ts` | Wide eth_call helper | Phase 6 |
| `src/wallet/session-manager.ts` | Multi-chain widening; `LedgerStatus.sessionTopicLast8` field already present | Phase 8; Phase 9 reads via `getStatus()` only |
| `src/chains/registry.ts` | Per-chain client factory | Phase 8 |
| `src/config/contracts.ts` | `ContractsForChain` surface + getters; Phase 9 CONSUMES via `getAaveV3PoolAddress` + `getWethAddress` only | Phase 8 |
| Phase 8 Layer 2 chain-mismatch refusal at `preview_send.ts:173-191` | Defense-in-depth chain check | Phase 9 layers Layer 0.5 BEFORE this region without modifying its bytes |
| Phase 8 Layer 2 chain-mismatch refusal at `send_transaction.ts` (mirror block) | Defense-in-depth | Phase 9 doesn't touch this region |

## 2. Pattern Assignments — Concrete Code to Copy

### `src/security/skill-integrity.ts` (Plan 09-02) — analog: `src/diagnostics/notice.ts`

**Dedup-per-session pattern** — copy verbatim from `src/diagnostics/notice.ts:37-60`:

```typescript
// Source: src/diagnostics/notice.ts (lines 37-60) — exact shape to mirror
let firstResponseEmitted = false;

export function consumeAutoDemoNotice(): string | null {
  if (firstResponseEmitted) return null;
  firstResponseEmitted = true; // Pitfall 4 mitigation: set BEFORE returning
  return AUTO_DEMO_NOTICE_TEMPLATE;
}

export function _resetAutoDemoNoticeForTesting(): void {
  firstResponseEmitted = false;
}
```

**Phase 9 adaptation** — same dedup discipline; the consume helper takes the integrity state and returns the appropriate template (missing vs tampered) OR null on OK:

```typescript
// Source: src/security/skill-integrity.ts (Plan 09-02 — sketch from research § Topic 3)
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  VAULTPILOT_NOTICE_TEMPLATE_MISSING,
  VAULTPILOT_NOTICE_TEMPLATE_TAMPERED,
} from "../signing/blocks.js";

// EXPECTED_SKILL_SHA256 — coordinated bump with sister-repo tag release.
// Format-fanout-sentinel: this constant is the SOT; grep across src/ returns
// exactly 1 hit. Updated when vaultpilot-preflight-skill ships a new tag.
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
let noticeEmitted = false;

export async function checkSkillIntegrity(): Promise<SkillIntegrityState> {
  if (cachedState !== null) return cachedState;
  // ... lazy probe + SHA-256 against PROBE_PATHS, set cachedState, return
}

export const _skillIntegrity = { checkSkillIntegrity };  // spy-affordance

export function consumeSkillIntegrityNotice(state: SkillIntegrityState): string | null {
  if (noticeEmitted) return null;
  if (state.kind === "ok") return null;
  noticeEmitted = true;  // set BEFORE returning — Pitfall 4 mitigation
  // ... build template via .replace({PATHS} / {PATH} / {COMPUTED} / {EXPECTED})
}

export function _resetSkillIntegrityForTesting(): void {
  cachedState = null;
  noticeEmitted = false;
}
```

**Pitfall — fs/promises in stdio context.** Lazy on first DISPATCH (not server boot) — boot-time IO blocks the MCP `initialize` handshake (Phase 5 retro). Mirrors `runUpdateCheckOnce` (Plan 05-03 DIAG-04) at `src/diagnostics/update-check.ts`.

**Spy-affordance discipline.** `_skillIntegrity` indirection MANDATORY per CLAUDE.md Conventions (ESM named-export bindings immutable; direct spies are no-ops for cross-export internal calls). Tests `vi.spyOn(_skillIntegrity, "checkSkillIntegrity")`. Mirrors `_simulation` / `_protocols` / `_aaveProtocols` / `_contracts` precedent.

---

### `src/server.ts` dispatcher-wrap extension (Plan 09-02) — analog: lines 153-161 auto-demo NOTICE wrap

**Current shape** (verified at `src/server.ts:142-162`):
```typescript
if (isAutoDemo()) {
  const notice = consumeAutoDemoNotice();
  if (notice !== null) {
    return {
      ...result,
      content: [{ type: "text" as const, text: notice }, ...result.content],
    };
  }
}
return result;
```

**Phase 9 addition** — mirror shape, append AFTER the auto-demo block and BEFORE the final `return result;`:
```typescript
// Plan 09-02 — VAULTPILOT NOTICE for skill integrity. Lazy-once-per-session
// SHA-256 against EXPECTED_SKILL_SHA256; OK → null (no NOTICE);
// missing/tampered → prepended block on the FIRST tool response that detects
// the failure (dedup-per-session via `noticeEmitted` flag in
// src/security/skill-integrity.ts).
const integrityState = await _skillIntegrity.checkSkillIntegrity();
const skillNotice = consumeSkillIntegrityNotice(integrityState);
if (skillNotice !== null) {
  return {
    ...result,
    content: [{ type: "text" as const, text: skillNotice }, ...result.content],
  };
}
```

**Ordering decision (planner's call, flagged here):** Auto-demo NOTICE fires FIRST (existing behavior); skill-integrity NOTICE fires SECOND. Pattern-mapper recommends this order — auto-demo is a one-time install-state announcement, skill-integrity is a defense-in-depth advisory; auto-demo reader has higher salience on a brand-new install. If a session triggers BOTH (auto-demo + skill missing), the user sees the auto-demo notice on dispatch #1 and the skill notice on dispatch #2 (each NOTICE is single-emission). No double-prepend on the same response — dispatch #1 returns auto-demo only, the skill NOTICE state machine doesn't tick because we hit `return` before the skill-integrity block.

**Test surface:** `test/server.skill-notice.test.ts` — mirror of `test/server.auto-demo-notice.test.ts` (dispatch loop, assert ONE prepend, then no further prepend; `_resetSkillIntegrityForTesting()` between scenarios).

---

### `src/security/canonical-dispatch.ts` (Plan 09-04) — analog: `src/config/contracts.ts:248-310` `KNOWN_SPENDERS_ETHEREUM` shape

**Curated-table-with-getter shape** — copy structural pattern from `src/config/contracts.ts`:

```typescript
// Source: src/security/canonical-dispatch.ts (Plan 09-04 — sketch from research § Topic 6)
import { getAddress, type Address } from "viem";

import {
  getAaveV3PoolAddress,
  getWethAddress,
  type ChainId,
} from "../config/contracts.js";

// Per-chain canonical dispatch targets. Sourced from existing per-chain
// getters (Aave V3 Pool, WETH9) + inline literals for cross-chain canonical
// routers that don't yet have getters (1inch V6, LiFi diamond — same
// address across Ethereum/Arbitrum/Polygon/Base/Optimism per A3 verified
// against KNOWN_SPENDERS_ETHEREUM + 1inch portal + LiFi docs).
//
// DF-2 LOCKED: parallel table — NOT a widening of KNOWN_SPENDERS_ETHEREUM.
// Rationale: spender-labels is a UI concern; dispatch-allowlist is a
// security gate. Two tables, two purposes, two evolution cadences.

const ONEINCH_V6_ROUTER_ALL_CHAINS = getAddress(
  "0x111111125421cA6dc452d289314280a0F8842A65",
);
const LIFI_DIAMOND_ALL_CHAINS = getAddress(
  "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
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

export const _canonicalDispatch = { checkDispatchTarget };  // spy-affordance
```

**Address sourcing — NEVER inline an Aave or WETH address.** Both reside in `src/config/contracts.ts` SOT; consume via the existing getters per CLAUDE.md "src/config/contracts.ts is the single source of truth for canonical contract addresses... Never inline an address in a tool implementation." The two inline literals (1inch V6 + LiFi) are explicitly outside the SOT (no existing getter; v2.4 widening scope where `prepare_custom_call` lands).

**Regression-test pattern:** `test/security-canonical-dispatch.test.ts` — per-chain coverage (5 chains × 4 entries = 20 membership assertions); `checkDispatchTarget(1, KNOWN_AAVE_POOL) === { kind: "ok" }`; `checkDispatchTarget(1, RANDOM_ADDR) === { kind: "refused", ... }`; EIP-55 round-trip (`getAddress(lowercased) → checksummed → membership holds`); ESM spy round-trip via `_canonicalDispatch`.

---

### `src/tools/preview_send.ts` Layer 0.5 wiring (Plan 09-04) — placement: BETWEEN handle lookup (line 144-156) and Layer 2 chain-mismatch (line 173-191)

**Current Layer 2 chain-mismatch shape** (`src/tools/preview_send.ts:158-191`):
```typescript
// Phase 8 — Plan 08-02. Layer 2 defense-in-depth chain-name MISMATCH refusal.
// ...
if (typeof args.chain === "string") {
  const claimedChainName = args.chain as ChainName;
  const claimedChainId = chainIdFromName(claimedChainName);
  if (claimedChainId !== record.tx.chainId) {
    // ... returns CHAIN_ID_MISMATCH envelope
  }
}
```

**Phase 9 Layer 0.5 insertion** — fires AFTER handle lookup (we need `record.tx.chainId` + `record.tx.to`) but BEFORE the Layer 2 chain-mismatch (line 173). Only fires when `record.tx.data !== "0x"` (native sends bypass — any `to` is valid for a value transfer):

```typescript
// NEW Plan 09-04: Layer 0.5 outer dispatch-target allowlist refusal. Fires
// AFTER handle lookup (needs record.tx.chainId + record.tx.to) and BEFORE
// the Phase 8 Layer 2 chain-name check. Only applies to contract calls
// (data !== "0x"); native sends bypass (any to is valid for value transfer).
//
// The escape hatch (v2.4 prepare_custom_call with acknowledgeNonProtocolTarget:
// true) is OUT OF SCOPE for v1.3 — protocol-routed prepare_* tools only.
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

**Test surface:** `test/preview-send.dispatch-allowlist.test.ts` — Layer 0.5 refusal at preview BEFORE Layer 2 chain check (race-test: a refusal that would ALSO trigger Layer 2 must hit Layer 0.5 first — visible via the errorCode in the response); native-send bypass (`data === "0x"` does NOT trigger refusal); ESM spy round-trip via `_canonicalDispatch`; `DISPATCH_TARGET_REFUSAL_TEMPLATE` byte-identity assertion.

---

### `src/tools/verify_tx_decode.ts` (Plan 09-05) — analog: `src/tools/check_contract_security.ts` (5-arm discriminated-union)

**Discriminated-union shape** — copy structural pattern from `check_contract_security.ts:67-89` (interface-per-arm) + simplify to 3 arms:

```typescript
// Source: src/tools/verify_tx_decode.ts (Plan 09-05 — sketch from research § Topic 5)
type Divergence = {
  field: string;        // "to" / "recipient" / "amount" / "spender" / "asset"
  agentSaid: string;
  serverSays: string;
};

type VerifyTxDecodeResult =
  | { kind: "ok" }
  | { kind: "divergence"; divergences: Divergence[] }
  | { kind: "decode-unsupported"; reason: string };

const DESCRIPTION = [
  "Server-side cross-check of the agent's claimed bytes-to-intent decode for a prepared transaction.",
  "Use AFTER preview_send and BEFORE send_transaction. The agent passes its OWN decoded view of the calldata; the server independently re-decodes via the same decoder preview_send uses and returns `{ kind: 'ok' }` on match or `{ kind: 'divergence', divergences: [...] }` with field-by-field diff.",
  "Distinct from get_verification_artifact (which is an OUT-OF-BAND second-LLM check); this is an INLINE server-side cross-check that catches narrow agent decode lies BEFORE the user is asked to confirm.",
  "Returns `{ kind: 'ok' | 'divergence' | 'decode-unsupported' }` discriminated union. `decode-unsupported` fires for contracts outside v1.3 decoder coverage (ERC-20, WETH9, Aave V3) — fall back to get_verification_artifact for second-LLM verification.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: { type: "string" },
    claimedDecode: {
      type: "object",
      properties: {
        to: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        action: { type: "string", enum: ["transfer", "approve", "withdraw", "aave-supply", "aave-withdraw"] },
        args: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["to", "action", "args"],
    },
  },
  required: ["handle", "claimedDecode"],
  additionalProperties: false,
};

registerTool("verify_tx_decode", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // 1. demo-mode check FIRST (T-DEMO-1 — mirror get_tx_verification:74-88)
  // 2. handle lookup via lookup() — mirror get_tx_verification:91-102
  // 3. independent decode via _protocols.decodeErc20Call + _aaveProtocols.decodeAaveV3Call
  //    (REUSE — single SOT; same code preview_send uses at preview_send.ts:381-391)
  // 4. on both unknown → kind: "decode-unsupported"; fall back hint to get_verification_artifact
  // 5. on a non-unknown decode, compare field-by-field per the per-action table (Topic 5)
  // 6. emit { kind: "ok" } | { kind: "divergence", divergences } structuredContent
});
```

**Field comparison rules** (research § Topic 5 table) — per-action:

| Action | Compared fields | Tolerances |
|---|---|---|
| `transfer` | `to` (record.tx.to — token contract), `recipient`, `amount` | Exact equality; decimal-string normalization via `parseAmountStrict(rawAmount, decimals)` reuse |
| `approve` | `to` (token), `spender`, `amount` (`"max"` ↔ `MAX_UINT256` strict equality) | Exact; `spenderLabel` from `lookupSpender(decoded.spender)` for diagnostic context |
| `withdraw` (WETH9) | `to` (canonical WETH9 per chain via `getWethAddress(chainId)`), `amount` | Exact; per-chain SOT lookup |
| `aave-supply` | `to` (Aave Pool per chain via `getAaveV3PoolAddress(chainId)`), `asset`, `amount`, `onBehalfOf` | Exact; per-chain SOT |
| `aave-withdraw` | Same as supply with `to` instead of `onBehalfOf` | Exact |

**Comparison with `check_contract_security`'s 5-arm shape:** verify_tx_decode has 3 arms (not 5) because the decode operation is deterministic — no rate-limit, no error arm (decoders never throw — `_protocols.decodeErc20Call` returns `{ kind: "unknown" }` on selector miss; `_aaveProtocols.decodeAaveV3Call` same). The simplification follows from determinism, not from a different conceptual model.

**Test surface:** `test/verify-tx-decode.test.ts` — anchored against EXISTING Fixtures D/E/F/G/H from Phases 6/7 (NO new fixtures per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" + research § Topic 9 line 856 lock). Coverage: (a) `ok` arm for transfer/approve/withdraw/supply/aave-withdraw happy paths; (b) `divergence` arm with 1-field flip per action (recipient typo, amount off-by-one wei, asset substitution, spender mismatch); (c) `decode-unsupported` arm for `data: "0xdeadbeef..."` selector; (d) `claimedDecode.to` ≠ `record.tx.to` mismatch (T-AAVE-TX-TO-CONFUSION-1 — agent claims `to` is the underlying asset but record has Pool address).

---

### `src/tools/get_verification_artifact.ts` (Plan 09-03) — analog: `src/tools/get_tx_verification.ts`

**Handle-lookup-and-emit pattern** — copy structural shape from `get_tx_verification.ts:73-128` (demo-mode-first, handle lookup, status branch), simplify the block payload to a single pasteableBlock:

```typescript
// Source: src/tools/get_verification_artifact.ts (Plan 09-03 — sketch from research § Topic 4)
import { isDemoMode } from "../config/env.js";
import { lookup } from "../signing/handle-store.js";
import { PASTEABLE_BLOCK_TEMPLATE } from "../signing/blocks.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Emit a sparse JSON + paste-able block for SECOND-LLM out-of-band verification of a prepared transaction.",
  "Use AFTER preview_send and BEFORE send_transaction when the user wants an independent decode from a second LLM (catches coordinated-agent compromise where this agent's narrative cannot be trusted).",
  "Returns `{ to, valueWei, data, chainId, payloadFingerprint, presignHash, selector }` as structuredContent + a `pasteableBlock` text payload bounded by explicit copy markers. Instruct the user: copy everything between the markers, paste into a fresh Claude/GPT/Gemini session, compare that LLM's decode against this conversation's narrative. Disagreement → DO NOT SIGN.",
  "Do NOT use as the only verification — the LEDGER BLIND-SIGN HASH on-device match is the trust anchor; this is defense-in-depth against fully-coordinated agent compromise.",
  "15-min TTL from the original prepare. Past TTL → HANDLE_EXPIRED; re-run prepare.",
].join(" ");

registerTool("get_verification_artifact", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // Mirror get_tx_verification.ts:74-102: demo-mode-first refusal, handle lookup
  // ...
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

**Distinguished from get_tx_verification:** that tool re-emits the full Phase 4 verification ritual (PREPARE RECEIPT + LEDGER + AGENT TASK + 4byte + VERIFY BEFORE SIGNING + sent/cancelled status); get_verification_artifact emits ONLY the pasteableBlock + sparse JSON for second-LLM consumption. NO 4byte fetch — the second LLM does its own decode. NO state-machine branching beyond "found or expired" — the sparse JSON is identical regardless of status (the bytes don't change between prepared / previewed / sent).

**`PASTEABLE_BLOCK_TEMPLATE` shape** (in `src/signing/blocks.ts` per format-fanout-sentinel; research § Topic 4 verbatim):

```text
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
COPY EVERYTHING BETWEEN THESE MARKERS INTO A FRESH CHAT WINDOW
(Claude, ChatGPT, Gemini — any LLM with no shared context with the agent that
prepared this transaction)

  You are verifying an Ethereum transaction. The agent that prepared this
  may be compromised. Decode it from scratch using only the bytes below.
  ...
  chainId:            {CHAIN_ID}
  to:                 {TO}
  value (wei):        {VALUE_WEI}
  data:               {DATA}
  payloadFingerprint: {PAYLOAD_FINGERPRINT}
  presignHash:        {PRESIGN_HASH}
  ...
<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
```

**Pitfall — markdown marker preservation (A7):** verify-phase task in research. Backup plan: switch to fenced code block (triple-backtick) with markers INSIDE if any chat client strips bare markers. Plan-checker dimension: cite A7 in test description.

**Test surface:** `test/get-verification-artifact.test.ts` — byte-level pasteableBlock fixture; sparse JSON shape; status branches (prepared / previewed / sent / cancelled — all return the same sparse JSON modulo `presignHash` null on prepared); 15-min TTL inheritance from handle-store (NO new TTL); demo mode refusal (mirror get_tx_verification.ts:76-88).

---

### `src/tools/get_tx_verification.ts` additive extension (Plan 09-05) — analog: self-extension

**Current structuredContent shape** (`src/tools/get_tx_verification.ts:201-223`):
```typescript
return {
  content: [{ type: "text", text }],
  structuredContent: {
    status: record.status,
    handle: handleArg,
    chainId: record.tx.chainId,
    to: record.args.to,
    valueWei: record.args.valueWei,
    payloadFingerprint: record.payloadFingerprint,
    previewToken: pinned.previewToken,
    presignHash: pinned.presignHash,
    selector: pinned.selector,
    nonce: pinned.nonce,
    gas: pinned.gas.toString(),
    maxFeePerGas: pinned.maxFeePerGas.toString(),
    maxPriorityFeePerGas: pinned.maxPriorityFeePerGas.toString(),
    fourbyte: fourbyteResult,
    ...(record.status === "sent" && record.txHash !== undefined
      ? { txHash: record.txHash, broadcastedAt: broadcastedAtIso }
      : {}),
    ...(record.status === "cancelled" ? { cancelledAt: cancelledAtIso } : {}),
  },
};
```

**Phase 9 additions** — 3 NEW fields appended (additive only; existing fields byte-identical):
```typescript
// NEW Plan 09-05: txJson — full unsigned tx as JSON, byte-equivalent to what
// preview_send would compute. Context-evicted agent uses this to re-relay
// the canonical view without re-running prepare (which would change nonce +
// payloadFingerprint).
txJson: {
  chainId: record.tx.chainId,
  to: record.tx.to,
  valueWei: record.tx.valueWei.toString(),
  data: record.tx.data,
  nonce: pinned.nonce,
  gas: pinned.gas.toString(),
  maxFeePerGas: pinned.maxFeePerGas.toString(),
  maxPriorityFeePerGas: pinned.maxPriorityFeePerGas.toString(),
},
// NEW Plan 09-05: sessionTopicLast8 — surface WC topic for user cross-check
// against Ledger Live → Settings → Connected Apps. null in demo mode (no WC).
sessionTopicLast8: isDemoMode() ? null : (await getStatus())?.sessionTopicLast8 ?? null,
// NEW Plan 09-05: dispatchCheckResult — re-runs Layer 0.5 check on the
// stored handle so a re-emit shows the user the same allowlist result the
// preview_send would have returned. Inexpensive — pure Set membership.
dispatchCheckResult: record.tx.data === "0x"
  ? { kind: "not-applicable" as const }
  : _canonicalDispatch.checkDispatchTarget(record.tx.chainId as ChainId, record.tx.to),
```

**`bigint` serialization decision (research § DF text line 841 — third potential fork):** All bigints serialize via `.toString()` (decimal) — consistent with existing `gas: pinned.gas.toString()` discipline at line 214. NOT hex. Decimal-string preserves round-trip + matches `valueWei: "1000000000000000000"` convention already in use. Plan-checker can surface a fork if they prefer hex; pattern-mapper locks decimal per existing precedent.

**FROZEN three-gate in send_transaction.ts — additive `sessionTopicLast8` placement.** The success-path structuredContent at `src/tools/send_transaction.ts:524-530` is OUTSIDE the three-gate region. Pattern-mapper verified: lines 524-530 are inside the final `return { ... }` AFTER `transitionToSent` completed; the three gates run earlier in the handler (PREP-07 schema gate at the validation boundary; PREP-08 fingerprint re-check + userDecision check at the front of the handler). Plan 09-05's add: append `sessionTopicLast8: status?.sessionTopicLast8 ?? null` to the existing success structuredContent block. The `status` variable is already available in scope (resolved earlier for `signClient.request`).

---

### `src/signing/error-codes.ts` extension (Plans 09-02 + 09-04 + 09-05) — analog: Phase 8 Plan 08-02 `CHAIN_ID_MISMATCH` addition

**Current union** (`src/signing/error-codes.ts:43-59`) — 16 codes. Phase 9 adds 3:

```typescript
// Phase 9 — Plan 09-02 / 09-04 / 09-05. Three new codes appended; the 16
// existing entries byte-frozen.
//
//   SKILL_INTEGRITY_FAILURE  — Plan 09-02 (skill-integrity probe fails to
//                              find OR finds-and-fails-SHA the SKILL.md.
//                              NOT emitted as a refusal; surfaces via the
//                              VAULTPILOT NOTICE prepend. The errorCode
//                              exists for the diagnostics surface
//                              (get_vaultpilot_config_status.skillIntegrity)
//                              and for skill-side test scaffolding.)
//   DISPATCH_TARGET_REFUSED  — Plan 09-04 (Layer 0.5 preview_send refusal
//                              when record.tx.to is not in
//                              CANONICAL_DISPATCH_TARGETS for the bound chain;
//                              fires for contract calls only — native sends
//                              bypass per Topic 6 lock).
//   DECODE_DIVERGENCE         — Plan 09-05 (verify_tx_decode divergence arm —
//                              not auto-emitted as a refusal envelope per se;
//                              the tool returns the divergence in structuredContent
//                              and the agent's decision-policy + skill enforcement
//                              determine halt-or-proceed. errorCode exists for
//                              uniform envelope discipline.)

export type ErrorCode =
  | "WALLET_NOT_PAIRED"
  | ...existing 16 entries...
  | "SKILL_INTEGRITY_FAILURE"
  | "DISPATCH_TARGET_REFUSED"
  | "DECODE_DIVERGENCE";
```

**Plan-checker dimension:** exhaustive `switch` over `ErrorCode` in any downstream consumer breaks at compile time on the addition — surfaces omission BEFORE merge (per Phase 4 lock at error-codes.ts:1-9). Phase 9 plans MUST update any exhaustive consumer (likely zero — error codes are typically consumed by `makeStructuredError(code, ...)` which accepts any union member; `switch` over codes is rare).

## 3. Modification Touchpoints

### `src/tools/register-all.ts` — Plan 09-03 + 09-05 carve

**Current state** (`src/tools/register-all.ts:1-30`) — 30 lines, grouped by tool family. Phase 8 Plan 08-04 added `resolve_token` + `get_token_allowances` at lines 6-7 (read group); Phase 8 Plan 08-05 modified `set_active_account` (line 28) in place (no import-line change).

**Phase 9 carve** — TWO inserts AFTER `import "./get_tx_verification.js";` (line 25):
```typescript
import "./get_tx_verification.js";        // line 25 (existing — Phase 4)
import "./verify_tx_decode.js";           // NEW Phase 9 Plan 09-05
import "./get_verification_artifact.js";  // NEW Phase 9 Plan 09-05 + 09-03
import "./get_demo_wallet.js";            // line 26 (existing — Phase 5)
```

**Conflict-avoidance reasoning:**
- Phase 8 Plan 08-04 added at lines 6-7 (read-tool group) — distant line region.
- Phase 8 Plan 08-05 modified the file at line 28 internally (no import-line add).
- Phase 9 add at lines 25-26 region is conflict-free with all Phase 8 carves.

If executor runs Plan 09-03 + 09-05 in parallel, BOTH plans touch register-all.ts in the same line region. Pattern-mapper recommends: collapse the register-all.ts edit into ONE plan (recommend Plan 09-05 since it adds the second tool; Plan 09-03 ships `get_verification_artifact.ts` but the registration line lives in 09-05 along with `verify_tx_decode.ts`). OR sequence 09-03 before 09-05.

---

### `src/signing/blocks.ts` — Plans 09-02 + 09-03 + 09-04

**Pattern from Phase 7 + Phase 8 precedent** (`src/signing/blocks.ts:477-540` — Phase 7 Plan 07-03 + Phase 8 Plan 08-04 APPEND-ONLY discipline):

Phase 9 templates append AT THE END of the file. The existing 5 ERC-20 templates + 2 Aave templates + 1 SET-LEVEL template stay byte-frozen. Order of appending (within Phase 9 — plans can sequence):

1. Plan 09-02: `VAULTPILOT_NOTICE_TEMPLATE_MISSING`, `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED`
2. Plan 09-03: `PASTEABLE_BLOCK_TEMPLATE`
3. Plan 09-04: `DISPATCH_TARGET_REFUSAL_TEMPLATE`

Each template is referenced by ≤2 call sites (Plan 09-02 templates → `src/security/skill-integrity.ts::consumeSkillIntegrityNotice`; Plan 09-03 → `src/tools/get_verification_artifact.ts`; Plan 09-04 → `src/tools/preview_send.ts` Layer 0.5 block). Format-fanout-sentinel: one block, one home.

**Test surface:** each template gets a byte-identity assertion in its consumer's test file (Phase 6 + Phase 8 pattern); no separate `blocks.ts` test file needed.

## 4. Reusable Primitives — Phase 9 MUST Consume, NOT Reimplement

Per CLAUDE.md "no inline contract addresses" + FROZEN-area discipline.

| Primitive | Source | Phase 9 caller(s) | Notes |
|---|---|---|---|
| `_protocols.decodeErc20Call(data)` | `src/protocols/erc20.ts:158` | `verify_tx_decode.ts` | SOT — same decoder `preview_send` uses; no parallel re-decode |
| `_aaveProtocols.decodeAaveV3Call(data)` | `src/protocols/aave-v3.ts:144` | `verify_tx_decode.ts` | SOT — same as above for Aave |
| `WETH9_SELECTORS.withdraw` + WETH9 decode | `src/protocols/weth9.ts` | `verify_tx_decode.ts` (withdraw arm) | SOT — existing constants |
| `parseAmountStrict(amountStr, decimals)` | `src/signing/amount.ts` | `verify_tx_decode.ts` (decimal-string normalization for amount comparison) | FROZEN — read-only consumer |
| `lookup(handle)` | `src/signing/handle-store.ts:151-159` | `verify_tx_decode.ts`, `get_verification_artifact.ts` | FROZEN — same 15-min TTL semantics |
| `isDemoMode()` | `src/config/env.ts` | `verify_tx_decode.ts`, `get_verification_artifact.ts` (demo-mode-first refusal) | FROZEN |
| `getStatus()` | `src/wallet/session-manager.ts` | `get_tx_verification.ts` additive `sessionTopicLast8`; (real-mode only — short-circuit in demo) | FROZEN — read-only consumer |
| `getAaveV3PoolAddress(chainId)` | `src/config/contracts.ts` | `src/security/canonical-dispatch.ts` (allowlist seed) | FROZEN — SOT getter |
| `getWethAddress(chainId)` | `src/config/contracts.ts` | `src/security/canonical-dispatch.ts` (allowlist seed) | FROZEN — SOT getter |
| `chainNameFromId(chainId)` | `src/config/contracts.ts` | `preview_send.ts` Layer 0.5 refusal text + `get_tx_verification.ts` `dispatchCheckResult` | FROZEN |
| `makeStructuredError(code, message, cause?)` | `src/signing/error-codes.ts:78` | All new tools + Layer 0.5 refusal | FROZEN |
| `consumeAutoDemoNotice` shape | `src/diagnostics/notice.ts:37-60` | TEMPLATE for `consumeSkillIntegrityNotice` (Plan 09-02) — copy the dedup discipline | shape pattern, not direct call |
| Node `crypto.createHash("sha256")` | built-in | `src/security/skill-integrity.ts` SHA pin | built-in; no new dep |
| Node `fs/promises.readFile` | built-in | `src/security/skill-integrity.ts` probe | built-in; mirrors `src/diagnostics/check.ts::readPackageVersion` pattern |
| Node `os.homedir()` | built-in | `src/security/skill-integrity.ts` PROBE_PATHS[0] | built-in |
| Node `path.join()` | built-in | `src/security/skill-integrity.ts` PROBE_PATHS construction | built-in |

**Error codes** — Phase 9 adds 3 new codes (`SKILL_INTEGRITY_FAILURE`, `DISPATCH_TARGET_REFUSED`, `DECODE_DIVERGENCE`). Otherwise reuses existing 16 — `HANDLE_NOT_FOUND` / `HANDLE_EXPIRED` for handle lookup misses in both new tools; `DEMO_MODE_REFUSED` for demo refusal; `INTERNAL_ERROR` for defensive catch-all.

## 5. Anti-Patterns Phase 9 MUST NOT Repeat

From CLAUDE.md conventions + Phase 1-8 retros:

1. **No re-implementation of decoders.** `verify_tx_decode` REUSES `_protocols.decodeErc20Call` + `_aaveProtocols.decodeAaveV3Call` — single SOT. Building a parallel ABI parser would create a divergence surface where the cross-check itself becomes a foot-gun. Research § Topic 5 lock + A6 verification.
2. **No new fingerprint fixture.** Cryptographic-binding chain FROZEN — `verify_tx_decode` tests anchor against EXISTING Fixtures D/E/F/G/H from Phases 6/7. NO new fixture. Research § Topic 9 line 856.
3. **No widening of `KNOWN_SPENDERS_ETHEREUM`.** DF-2 LOCKED — parallel `CANONICAL_DISPATCH_TARGETS` table; UI-label concerns stay separate from security-gate concerns. Phase 8's per-chain known-spender deferral holds.
4. **No fetch-stub for skill integrity.** SHA-256 is a LOCAL file read + Node `crypto` — no HTTP boundary. Don't reach for `vi.stubGlobal("fetch", …)` patterns from `test/fourbyte.test.ts` — use direct `vi.spyOn(_skillIntegrity, "checkSkillIntegrity")` instead.
5. **ESM spy-affordance pre-emptively.** `src/security/skill-integrity.ts` ships `export const _skillIntegrity = { checkSkillIntegrity };` from the first commit; `src/security/canonical-dispatch.ts` ships `export const _canonicalDispatch = { checkDispatchTarget };` from the first commit. Per CLAUDE.md "Add the indirection at write time, not retroactively."
6. **FROZEN-area discipline in every plan's `<success_criteria>`.** Each Phase 9 plan asserts zero-diff on: `payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates, all `src/protocols/*.ts`, all `src/clients/*.ts`. Phase 8 inherited; Phase 9 inherits.
7. **No new TTL.** `get_verification_artifact` + `verify_tx_decode` BOTH inherit the existing `HANDLE_TTL_MS = 15 * 60 * 1000` from `src/signing/handle-store.ts:21`. NO new constant.
8. **No blocking server boot.** Skill SHA-256 fires on FIRST TOOL DISPATCH, not server boot. Mirror of Plan 05-03 `runUpdateCheckOnce` lazy pattern at `src/diagnostics/update-check.ts`. Research § Topic 3 Pitfall.
9. **No silent fallback on missing skill.** `VAULTPILOT NOTICE — skill not installed` block surfaces explicitly with install instructions. The MCP doesn't downgrade silently to "defense-in-depth reduced" — the user sees the gap.
10. **No second-LLM round-trip via MCP.** `get_verification_artifact` is a USER ritual — the second LLM's answer is read by the user, NOT passed back through the MCP. The MCP has no awareness of the second-LLM's verdict. Research § Topic 4 explicit lock.

## 6. Cryptographic-Binding Chain Delta

### What Phase 9 changes

- **`preview_send.ts`** gains Layer 0.5 dispatch-allowlist refusal BEFORE existing Layer 2 chain-mismatch (additive — fires only for `data !== "0x"`).
- **`preview_send.ts`** success structuredContent gains `sessionTopicLast8` field (pure addition).
- **`send_transaction.ts`** success structuredContent gains `sessionTopicLast8` field (pure addition; FROZEN three gates UNCHANGED).
- **`get_tx_verification.ts`** structuredContent gains 3 fields: `txJson`, `sessionTopicLast8`, `dispatchCheckResult` (pure addition).
- **`server.ts`** dispatcher gains skill-integrity NOTICE prepend (mirror of auto-demo wrap; same dedup discipline).
- **`error-codes.ts`** locked union gains 3 entries (16 → 19).

### What Phase 9 does NOT touch (FROZEN — assert zero-diff in every Plan)

- `src/signing/payload-fingerprint.ts` — preimage shape `DOMAIN_TAG ‖ chainId ‖ to ‖ value ‖ data` byte-frozen.
- `src/signing/presign-hash.ts` — EIP-1559 RLP byte-frozen.
- `src/signing/handle-store.ts` — state machine + TTL byte-frozen.
- `src/tools/send_transaction.ts` three-gate region — schema gate + state-machine gate + fingerprint-drift gate byte-frozen. The additive `sessionTopicLast8` field lands OUTSIDE this region (success-path structuredContent only; verified at lines 524-530).
- All `src/protocols/*.ts` decoders — `verify_tx_decode` consumes via existing `_protocols.*` indirections; NO source edit.
- All `src/clients/*.ts` — etherscan + fourbyte byte-frozen.
- Phase 7 `aave-health.ts`, Phase 6 `amount.ts` + `simulation.ts` — byte-frozen.
- Phase 8 Layer 2 chain-mismatch at `preview_send.ts:173-191` — Phase 9 layers Layer 0.5 BEFORE without modifying these lines.
- All Phase 6/7/8 fixtures (A-H) byte-identity holds across the persona-cycle integration tests. NO new persona-cycle fixtures this phase.

### NO NEW FIXTURE THIS PHASE

`verify_tx_decode` test anchors against EXISTING Fixtures D/E/F/G/H. Per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" — only NEW shapes of `payloadFingerprint`/`presignHash` input warrant new fixtures. Phase 9 introduces NO new tx shape; the cross-check operates over EXISTING shapes.

## 7. Test Surface Notes

### New test files (Wave 0 gaps per research § lines 887-898)

| Test File | Scope | Mirrors |
|---|---|---|
| `test/security-skill-integrity.test.ts` | `ok` / `missing` / `tampered` state coverage + dedup-per-session + `_resetSkillIntegrityForTesting` hook | `test/notice.test.ts` (auto-demo NOTICE dedup pattern) |
| `test/security-canonical-dispatch.test.ts` | Per-chain allowlist coverage (5 chains × ~4 entries) + `checkDispatchTarget` ok / refused branches + EIP-55 round-trip + ESM spy round-trip via `_canonicalDispatch` | `test/config-contracts.test.ts` (curated-table assertions) |
| `test/server.skill-notice.test.ts` | Dispatcher-wrap prepend on first dispatch + dedup verification | `test/server.auto-demo-notice.test.ts` (existing wrap test) |
| `test/verify-tx-decode.test.ts` | Happy paths against Fixtures D/E/F/G/H + 1-field-flip divergences (recipient typo, amount off-by-one, asset substitution, spender mismatch) + decode-unsupported arm for unknown selector + `claimedDecode.to ≠ record.tx.to` mismatch (T-AAVE-TX-TO-CONFUSION-1) | `test/preview-send.aave.test.ts` (decoder fixture reuse) + `test/check-contract-security.test.ts` (discriminated-union assertion shape) |
| `test/get-verification-artifact.test.ts` | pasteableBlock byte-level fixture + sparse JSON shape + status branches (prepared / previewed / sent / cancelled) + 15-min TTL inheritance + demo mode refusal | `test/get-tx-verification.test.ts` (handle-lookup tool pattern) |
| `test/preview-send.dispatch-allowlist.test.ts` | Layer 0.5 refusal at preview BEFORE Layer 2 chain check + native-send bypass (`data === "0x"`) + ESM spy round-trip + `DISPATCH_TARGET_REFUSAL_TEMPLATE` byte-identity | `test/preview-send.test.ts` (existing scaffolding) |

### Extended test files

| Test File | Extension |
|---|---|
| `test/get-tx-verification.test.ts` | NEW assertions: `txJson` structuredContent field shape + bigint-as-decimal-string discipline + `sessionTopicLast8` field (real-mode vs demo-mode) + `dispatchCheckResult` field (kind: "ok" vs "refused" vs "not-applicable" for native send) |
| `test/preview-send.test.ts` | NEW assertion: `sessionTopicLast8` additive field on success path (mirror of existing structuredContent assertions) |
| `test/send-transaction.test.ts` | NEW assertion: `sessionTopicLast8` additive field on success path; verify FROZEN three-gate UNCHANGED (regression test — assert `git diff` shows ONLY the additive line within the success-path structuredContent block) |
| `test/get-vaultpilot-config-status.test.ts` | NEW assertion: `skillIntegrity: { kind, path?, sha256? }` field surfacing in diagnostics (secret-safe — no `computed` / `expected` on the diagnostic surface; SHA bytes only on `ok` arm) |
| `test/pair_ledger_live_wait.test.ts` (parity check) | Confirm `sessionTopicLast8` already surfaced (verified at file:106-111) — no source edit needed. If test gap surfaces, add coverage. |

### Fetch-stub applicability

The pattern-mapping prompt asked about external network clients. **Answer: no new HTTP-client modules.** SHA-256 is local file read + Node crypto; pasteableBlock is local-only emission; verify_tx_decode reuses local decoders. NO fetch boundary. CLAUDE.md Conventions: "For external network clients (`src/clients/fourbyte.ts`, `src/clients/etherscan.ts`), prefer `vi.stubGlobal('fetch', …)` at the network boundary over an internal indirection — the test seam is at the OUTER edge, not between exports." Phase 9 has zero new fetch boundaries; tests use `vi.spyOn(_skillIntegrity, ...)` + `vi.spyOn(_canonicalDispatch, ...)` for the internal-call surfaces (per CLAUDE.md exception clause).

## 8. Parallelism Opportunities + Wave Structure Recommendation

The pattern-mapper validates the prompt's 5-plan split with a refinement based on file-touch overlap analysis.

### Recommended carve order: 09-01 → (09-02 ∥ 09-04) → (09-03 ∥ 09-05) → close-out

- **Plan 09-01** — Sister-repo bootstrap. OUT-OF-CODEBASE. Touches: `vaultpilot-preflight-skill/` new GitHub repo (`gh repo create` user-checkpoint), `SKILL.md`, `README.md`, sister-repo CI smoke. NO src/ touches. Sequential prerequisite for 09-02 (the SHA pin depends on a published SKILL.md tagged release).

- **Plan 09-02** — Skill-integrity probe + VAULTPILOT NOTICE. Touches: `src/security/skill-integrity.ts` (NEW), `src/server.ts` (additive dispatcher-wrap at lines 153-161 region), `src/signing/blocks.ts` (additive `VAULTPILOT_NOTICE_TEMPLATE_MISSING` + `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED`), `src/signing/error-codes.ts` (additive `SKILL_INTEGRITY_FAILURE`), `src/tools/get_vaultpilot_config_status.ts` (additive `skillIntegrity` field), `test/security-skill-integrity.test.ts` (NEW), `test/server.skill-notice.test.ts` (NEW), `test/get-vaultpilot-config-status.test.ts` (extend). **Parallel-safe with 09-04** — zero file-touch overlap (09-04 touches `src/security/canonical-dispatch.ts` + `src/tools/preview_send.ts` Layer 0.5; both blocks.ts + error-codes.ts modifications are APPEND-ONLY at the end of file, no line conflict).

- **Plan 09-04** — Outer dispatch-target allowlist. Touches: `src/security/canonical-dispatch.ts` (NEW), `src/tools/preview_send.ts` (additive Layer 0.5 refusal at the chain-mismatch region), `src/signing/blocks.ts` (additive `DISPATCH_TARGET_REFUSAL_TEMPLATE`), `src/signing/error-codes.ts` (additive `DISPATCH_TARGET_REFUSED`), `test/security-canonical-dispatch.test.ts` (NEW), `test/preview-send.dispatch-allowlist.test.ts` (NEW). **Parallel-safe with 09-02** (blocks.ts + error-codes.ts append-only at end-of-file — no line collision).

- **Plan 09-03** — `get_verification_artifact`. Touches: `src/tools/get_verification_artifact.ts` (NEW), `src/signing/blocks.ts` (additive `PASTEABLE_BLOCK_TEMPLATE`), `src/tools/register-all.ts` (+1 import line at line 25-26 region), `test/get-verification-artifact.test.ts` (NEW). **Depends on 09-02 NOR 09-04** at the source-edit level; can run after either lands.

- **Plan 09-05** — `verify_tx_decode` + `get_tx_verification` re-spec + WC session-topic surfacing. Touches: `src/tools/verify_tx_decode.ts` (NEW), `src/tools/get_tx_verification.ts` (additive 3 fields), `src/tools/preview_send.ts` (additive `sessionTopicLast8` field on success structuredContent — distinct line region from 09-04's Layer 0.5 insertion), `src/tools/send_transaction.ts` (additive `sessionTopicLast8` on SUCCESS path — verify three-gate UNCHANGED), `src/signing/error-codes.ts` (additive `DECODE_DIVERGENCE`), `src/tools/register-all.ts` (+1 import line for verify_tx_decode), `test/verify-tx-decode.test.ts` (NEW), `test/get-tx-verification.test.ts` (extend), `test/preview-send.test.ts` (extend), `test/send-transaction.test.ts` (extend). **Sequential after 09-04** for clean preview_send.ts line-region carve (09-04 inserts BEFORE Layer 2 at lines 173-191; 09-05 inserts at success structuredContent at lines 559-581 — distinct regions, no rebase needed, but parallelism risks confusing `tsc` if both branches write at the same time).

### File-touch overlap matrix (load-bearing for parallelism)

| | 09-01 | 09-02 | 09-03 | 09-04 | 09-05 |
|---|---|---|---|---|---|
| 09-01 | — | depends-on (skill SHA) | none | none | none |
| 09-02 | | — | overlaps on `blocks.ts` (APPEND-ONLY — no conflict) + `error-codes.ts` (APPEND-ONLY — no conflict) | overlaps on `blocks.ts` + `error-codes.ts` (both APPEND-ONLY — no conflict) | overlaps on `error-codes.ts` (APPEND-ONLY — no conflict) |
| 09-03 | | | — | none | overlaps on `register-all.ts` (both adds at line 25-26 region — RECOMMEND collapse into one plan) + `blocks.ts` APPEND-ONLY |
| 09-04 | | | | — | overlaps on `preview_send.ts` (distinct line regions — Layer 0.5 at 173 region vs success structuredContent at 559 region; safe) + `error-codes.ts` APPEND-ONLY |
| 09-05 | | | | | — |

**Conclusion:** 09-02 ∥ 09-04 is the cleanest parallel boundary (zero source-edit collision — both modify shared files but in append-only positions). 09-03 ∥ 09-05 has a `register-all.ts` collision risk; pattern-mapper recommends **collapse the register-all.ts edit into Plan 09-05** (Plan 09-05 already adds `verify_tx_decode.js`; bundling `get_verification_artifact.js` registration in the same plan removes the parallel-rebase risk). Plan 09-03 then ships ONLY the tool file + blocks template + test, with NO register-all touch.

**Refined wave structure:**
- **Wave A (sequential):** Plan 09-01 (sister-repo bootstrap, requires user checkpoint per `feedback_auto_mode.md`).
- **Wave B (parallel 2-way):** Plan 09-02 ∥ Plan 09-04. Both modify `blocks.ts` + `error-codes.ts` append-only; both add NEW src/security/ files; zero source-line collision.
- **Wave C (sequential after Wave B):** Plan 09-03 (no source-line collision with 09-02/09-04; deferred for cleanest sequencing).
- **Wave D (sequential after Wave C):** Plan 09-05 (register-all.ts adds BOTH new imports; depends on 09-03's tool file existing AND 09-04's Layer 0.5 insertion location being settled to avoid preview_send.ts line confusion).

### Resource-cost note (global CLAUDE.md rule)

Plan 09-02 is the largest plan in terms of file-touches (3 src/ touched + 2 test/ NEW + 1 test/ extended + sister-repo bootstrap coordination). The TypeScript compiler is the regression anchor — `tsc` after each touched file ensures the cascade is caught early. Pattern-mapper recommends executor checkpoint after each of: (a) `src/security/skill-integrity.ts` write + `tsc` green; (b) blocks.ts template additions + tsc green; (c) error-codes.ts addition + tsc green (exhaustive switch consumers fail here if any exist); (d) server.ts dispatcher-wrap + tsc green; (e) test file additions. Each sub-step is `tsc`-green at a clean checkpoint.

Phase 9 is NOT resource-intensive in the parallel-CPU sense (no `tsc` × N parallel build invocations; no API-heavy fan-out). The global CLAUDE.md "Phase Resource-Intensive Parallel Work Sequentially" rule's 2-way parallelism cap is comfortably respected at Wave B (09-02 ∥ 09-04).

## Metadata

**Analog search scope:** `src/tools/*.ts`, `src/security/*.ts` (NEW directory — confirmed empty), `src/diagnostics/*.ts`, `src/signing/*.ts`, `src/protocols/*.ts`, `src/clients/*.ts`, `src/wallet/*.ts`, `src/config/*.ts`, `src/server.ts`, `test/*.ts`, `.planning/phases/06-PATTERNS.md`, `.planning/phases/07-PATTERNS.md`, `.planning/phases/08-PATTERNS.md`
**Files scanned:** 11 source files (full read on 8: server.ts, blocks.ts, error-codes.ts, get_tx_verification.ts, diagnostics/notice.ts, check_contract_security.ts, handle-store.ts, get_ledger_status.ts; targeted reads on 3: preview_send.ts, send_transaction.ts, pair_ledger_live_wait.ts) + 3 prior PATTERNS.md (Phase 6/7/8) + 09-RESEARCH.md (full, in two chunks) + CLAUDE.md (project)
**Pattern extraction date:** 2026-05-18
**No-analog items:** 0 — every Phase 9 file extends an existing pattern; the closest analogs (Plan 05-03 dispatcher-wrap, Plan 07-04 discriminated-union, Plan 04-05 handle-lookup tool, Plan 06-03 SOT-curated-table) are all in-tree and well-rehearsed.
**FROZEN-area assertion files:** 12 + Phase 8 Layer 2 region (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three-gate region, `clients/etherscan.ts`, `clients/fourbyte.ts`, `protocols/aave-v3.ts`, `protocols/erc20.ts`, `protocols/weth9.ts`, `signing/aave-health.ts`, `signing/amount.ts`, `signing/simulation.ts`, plus `wallet/session-manager.ts` + `chains/registry.ts` + `config/contracts.ts` for Phase 8 surfaces) — empirically verified against current source tree
**Wave-parallelism boundary:** 09-02 ∥ 09-04 (zero source-line collision via append-only discipline)
**Sister-repo bootstrap:** `vaultpilot-preflight-skill/` — execute-time user checkpoint per `feedback_auto_mode.md`; pattern-mapper documents SKILL.md structure here, planner stages the actual `gh repo create`
