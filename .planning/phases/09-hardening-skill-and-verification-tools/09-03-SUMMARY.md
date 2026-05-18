---
phase: 09
plan: 03
subsystem: src/tools/get_verification_artifact.ts sparse-JSON + pasteableBlock for second-LLM out-of-band verification ritual
tags: [get-verification-artifact, sec-34, pasteable-block, second-llm-ritual, sparse-json, byte-stable-template, coordinated-agent-compromise, defense-in-depth, phase-9, wave-3]
requirements: [SEC-34]
wave: 3
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "Plan 09-02 (src/signing/blocks.ts at line-734 VAULTPILOT_NOTICE_TEMPLATE_TAMPERED end-of-file — append happens AFTER this template); HANDLE_TTL_MS 15-min constant from Plan 04-01"
    - "Plan 04-05 get_tx_verification.ts scaffolding analog — handle-lookup + demo-mode-first + isDemoMode shape; mirror but simplified"
  provides:
    - "src/tools/get_verification_artifact.ts (NEW — 138 LOC) — registers MCP tool `get_verification_artifact({ handle })`; demo-mode-first refusal; `lookup(handleArg)` with 15-min TTL inheritance; sparse JSON structuredContent { to, valueWei (string), data, chainId, payloadFingerprint, presignHash, selector }; pasteableBlock composed via 6 PASTEABLE_BLOCK_TEMPLATE.replace(...) substitutions; null presignHash JSON / `(not yet previewed)` text on prepared state"
    - "src/signing/blocks.ts +57 lines APPEND-ONLY PASTEABLE_BLOCK_TEMPLATE — 32-line text template; 80-char `>>>>` open + `<<<<` close markers; 6 substitution slots ({CHAIN_ID}, {TO}, {VALUE_WEI}, {DATA}, {PAYLOAD_FINGERPRINT}, {PRESIGN_HASH}); embedded 5-step canned decode prompt for second LLM; Unicode U+2016 (`‖`) preserved in Step 5 keccak preimage notation"
    - "test/get-verification-artifact.test.ts (NEW — 623 lines, 18 cases) — T-PASTEABLE-BYTE-IDENTITY-1 byte-level fixture (Test 1) + sparse JSON shape (Test 2) + status branches prepared/sent/cancelled (Tests 3-5) + demo refusal (Test 6) + HANDLE_NOT_FOUND (Test 7) + HANDLE_EXPIRED past 15-min TTL (Test 8) + HANDLE_TTL_MS constant inheritance (Test 9) + ERC-20 selector (Test 10) + native-send selector null (Test 11) + Aave-supply long-calldata single-line (Test 12) + valueWei string serialization (Test 13) + payloadFingerprint regex (Test 14) + marker presence (Tests 15-16) + canned prompt structure (Test 17) + Unicode U+2016 preservation (Test 18)"
  affects: []
  unblocks:
    - "Plan 09-05 (verify_tx_decode + register-all consolidation) — Plan 09-05 owns the register-all.ts import line addition for BOTH ./verify_tx_decode.js AND ./get_verification_artifact.js (Plan 09-03 ships the tool file ONLY; production MCP dispatch wiring deferred per PATTERNS.md § 3 carve coordination). Plan 09-05's verify_tx_decode decode-unsupported arm REFERENCES get_verification_artifact as the second-LLM fallback path in the tool description routing."
    - "v1.3 release coordination — the user-driven second-LLM out-of-band ritual closes SEC-34; combined with Plan 09-01 (skill bootstrap) + Plan 09-02 (skill integrity pin) + Plan 09-04 (canonical-dispatch refusal) + Plan 09-05 (inline cross-check), Phase 9 ships the full hardening + verification surface"
tech-stack:
  added: []
  patterns:
    - "Sparse JSON discipline (RESEARCH § Topic 4 lines 285-295) — the structuredContent payload deliberately OMITS narrative fields (previewToken / nonce / gas / fourbyte / status / handle) so the agent is incentivized to PASTE the block rather than re-emit the JSON. Verification-relevant bytes only: { to, valueWei (string), data, chainId, payloadFingerprint, presignHash, selector }. Test 2 asserts the exact shape via toStrictEqual + per-field toNotHaveProperty for the negative."
    - "Byte-stable text template with explicit copy markers (RESEARCH § Topic 4 lines 333-365) — 80-char `>>>>` / `<<<<` markers frame the second-LLM-ingestable region; user copies everything between them into a fresh chat. Template join() with `.replace()` for 6 slots; T-PASTEABLE-BYTE-IDENTITY-1 anchor (Test 1) compares against a hardcoded literal in the test file (NOT a beforeAll-snapshot per CLAUDE.md § Cryptographic-binding fixtures discipline). Drift in template or substitution fails at a specific line, not against a self-snapshot."
    - "Audience-shift design — first non-human / non-skill-parser audience in the codebase. Plan 04-05 get_tx_verification re-emits for the USER's visual rehearsal; Plan 08-04 [SET-LEVEL ENUMERATION] block targets the vaultpilot-preflight skill's parser; Plan 09-03 PASTEABLE_BLOCK targets a SECOND LLM in a fresh chat session with no shared context. The 5-step canned prompt's first sentence ('You are verifying an Ethereum transaction. The agent that prepared this may be compromised. Decode it from scratch using only the bytes below.') is the load-bearing audience cue."
    - "APPEND-ONLY discipline on src/signing/blocks.ts — Plan 09-03 appends PASTEABLE_BLOCK_TEMPLATE AFTER the Plan 09-02 VAULTPILOT_NOTICE_TEMPLATE_TAMPERED end-of-file template (line 734 pre-edit). Existing 19 templates (Phase 4 + Phase 6 + Phase 7 + Phase 8 + Plan 08-04 + Plan 09-02) BYTE-FROZEN; `git diff origin/main -- src/signing/blocks.ts | grep '^-'` returns zero deletions. Plan 09-04 (DISPATCH_TARGET_REFUSAL_TEMPLATE) is parallel-eligible and appends to a distinct end-of-file region — zero source-line collision."
    - "15-min TTL inheritance via existing constant — Plan 09-03 introduces NO new TTL. The `lookup()` call in get_verification_artifact.ts honors HANDLE_TTL_MS from handle-store.ts:21; past TTL → HANDLE_EXPIRED envelope (existing code from Phase 4). Test 9 asserts the constant equals 15 minutes (sanity check — if anyone ever changes it, both get_tx_verification AND get_verification_artifact are affected from a single SOT). Test 8 exercises the eviction via vi.useFakeTimers + advanceTimersByTime(HANDLE_TTL_MS + 1)."
    - "No new error codes — Plan 09-03 reuses DEMO_MODE_REFUSED + HANDLE_NOT_FOUND + HANDLE_EXPIRED from the existing 17-code union. Zero diff to src/signing/error-codes.ts. Reduces ErrorCode union churn for Phase 9 (only Plan 09-02 added SKILL_INTEGRITY_FAILURE; 09-03/04/05 all reuse existing codes per RESEARCH § Topic 9)."
    - "register-all.ts carve coordination (PATTERNS.md § 3 lines 568-585 + § 8) — Plan 09-05 owns the import line for BOTH verify_tx_decode.js AND get_verification_artifact.js. Plan 09-03 ships the tool file ONLY; production MCP dispatch is NOT wired until 09-05 lands. Tests reach the tool via direct module import (`await import('../src/tools/get_verification_artifact.js')`) which fires the `registerTool` side-effect at module load; getRegisteredTool('get_verification_artifact') is then available in the test process. The user-facing impact is zero for v1.3 release since both plans land in the same milestone."
key-files:
  created:
    - "src/tools/get_verification_artifact.ts (NEW — 138 lines)"
    - "test/get-verification-artifact.test.ts (NEW — 623 lines, 18 cases)"
    - ".planning/phases/09-hardening-skill-and-verification-tools/09-03-SUMMARY.md (NEW — this file)"
  modified:
    - "src/signing/blocks.ts (+57 lines APPEND-ONLY — PASTEABLE_BLOCK_TEMPLATE at end-of-file; existing 19 templates byte-frozen)"
decisions:
  - "**makeStructuredError() not used in this tool — direct object literals match get_tx_verification.ts:86 + 100 + 142 in-tree pattern.** Initial draft imported makeStructuredError from src/signing/error-codes.ts for the demo-mode + HANDLE_NOT_FOUND + HANDLE_EXPIRED envelopes. TypeScript rejected the StructuredError return type — ToolHandlerResult requires `structuredContent: Record<string, unknown>`, and StructuredError lacks the index-signature. Rather than fight the type system or change the StructuredError shape (out of scope for 09-03; would ripple to every Phase 4 tool), reverted to direct `{ errorCode, message }` object literals — exactly the shape get_tx_verification.ts uses at lines 86 / 100 / 142 (`{ errorCode: 'DEMO_MODE_REFUSED' }` / `{ errorCode: lookupResult.errorCode }`). This is in-tree conventional and unblocks Plan 09-03 without architectural drift. Future hardening could lift the StructuredError type to extend Record<string, unknown>, but that's a cross-tool refactor (12+ call sites) — out of scope here."
  - "**LookupResult uses `ok: true/false`, not `kind: 'found'/'not-found'/'expired'` as the plan body's interface mockup suggested.** The plan's `<interfaces>` block (line 122-124) sketched `LookupResult` as a discriminated union on `kind`. The actual in-tree type at src/signing/handle-store.ts:105-107 discriminates on `ok`. Followed the in-tree shape (which is the FROZEN type) and pulled the errorCode off the failure arm directly. No deviation impact — the plan's interface sketch was a documentation drift, not a contract."
  - "**Single-line PASTEABLE_BLOCK width assertion for Aave supply (Test 12) — 266 hex chars + `  data:               ` (20-char prefix) = 286 chars total on one line.** Per RESEARCH § Topic 4 Pitfall + accepted-residual T-LONG-CALLDATA-WRAPPING-1, v1.3 scope (ERC-20 / WETH9 / Aave V3) all fit on a single line in the data field. Long-calldata cases (Uniswap LP / Safe multisig) are v2.4+ scope. Test 12 asserts the exact match `dataLine === \"  data:               ${AAVE_SUPPLY_DATA}\"` — no intermediate `\\n` wrap, no line-continuation markers. Future v2.4+ widening would need a chunking helper analogous to chunkHex (used by LEDGER_BLIND_SIGN_HASH_TEMPLATE for the 64-hex presignHash); not in scope here."
  - "**Test 1 byte-fixture computed once via `node -e` against the built dist/ template, then pinned as a hardcoded literal.** The plan's <action> step 4 instructed computing the fixture at execute time. Executed: built once via `npm run build`, then `node -e \"const { PASTEABLE_BLOCK_TEMPLATE } = require('./dist/signing/blocks.js'); ... .replace(...) ... process.stdout.write(JSON.stringify(block));\"`. Pinned the result as `EXPECTED_PASTEABLE_BLOCK_FIXTURE_PREVIEWED: string = [...lines...].join('\\n')` in the test file. The fixture is independent of the source under test (lives in test file, not imported from blocks.ts) — drift in template OR substitution logic fails Test 1 at the specific line, not against a self-anchored snapshot."
  - "**No `_resetSkillIntegrityForTesting` / `_resetCanonicalDispatchForTesting` calls in beforeEach.** Plan 09-03 doesn't touch the Phase 9 skill-integrity or canonical-dispatch surfaces (Plans 09-02 + 09-04 own those); zero risk of test crosstalk. The test file matches the simpler beforeEach pattern from test/get-tx-verification.test.ts (reset handle-store + reset demo-mode + reset active-persona). Sister tests verified clean — full vitest suite 810 → 828 (+18) green, zero pre-existing tests regressed."
  - "**`isDemoMode()` check fires BEFORE handle lookup — defensive layering even though demo-mode handles cannot exist.** Plans 04-02/03/04 refuse to create / preview / send in demo mode, so a demo-mode caller cannot legitimately have a real handle in the store. The check is defense-in-depth — if a future plan accidentally allows handle creation in demo mode, get_verification_artifact still refuses (the second-LLM ritual is meaningless against simulated handles since they bypass real signing). Test 6 seeds a real-mode handle, then flips to demo mode, then calls — refusal fires regardless. Mirror of get_tx_verification.ts:76-88 demo-first ordering."
metrics:
  duration: "~25 minutes (single execution wave; one rework on the typecheck error — StructuredError type incompatibility with ToolHandlerResult.structuredContent's Record<string, unknown> requirement; resolved by reverting to direct object literals matching the in-tree get_tx_verification.ts pattern)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 3
  files_modified: 1
  loc_added: 720
  tests_added: 18
  test_count_trajectory: "810 → 828 (+18)"
---

# Phase 9 Plan 03 Summary: get_verification_artifact + pasteableBlock + canned second-LLM prompt

## One-liner

Ships `get_verification_artifact({ handle })` MCP tool — sparse JSON
structuredContent + verbatim 32-line `pasteableBlock` text payload (bounded
by 80-char `>>>>` / `<<<<` markers) carrying a 5-step canned decode prompt
for a SECOND LLM in a fresh chat session with no shared context. The user
copies the block into the second LLM, compares the independent decode
against the original agent's narrative, and halts on divergence. Closes
SEC-34. Defense-in-depth against fully-coordinated agent compromise where
the original agent's args AND narrative are both tampered with — every
existing MCP-side layer is bypassed because the bytes look right + the
claims look right. The MCP provides the bytes; the second LLM tells the
user what they mean.

## What Landed

### `src/tools/get_verification_artifact.ts` (NEW — 138 LOC)

- `registerTool("get_verification_artifact", DESCRIPTION, INPUT_SCHEMA, handler)`
  — side-effect registration at module load (tests reach via
  `getRegisteredTool` after explicit `await import(...)`; production MCP
  dispatch wiring deferred to Plan 09-05's register-all.ts edit).
- Demo-mode-first refusal (mirror of `get_tx_verification.ts:76-88`).
- Handle lookup via `lookup(handleArg)` — 15-min TTL inheritance.
- Sparse JSON structuredContent: `{ to, valueWei (string), data, chainId,
  payloadFingerprint, presignHash, selector }`. NO `previewToken` / `nonce`
  / `gas` / `fourbyte` / `status` / `handle` — those live in
  `get_tx_verification`.
- `presignHash`: `null` in JSON / `(not yet previewed)` text-slot on the
  prepared state; `pinned.presignHash` populated on previewed / sent /
  cancelled.
- `selector`: `null` for native sends (data === `"0x"`); first 10 chars of
  data for contract calls (`0xa9059cbb` for ERC-20 transfer, `0x617ba037`
  for Aave V3 supply).
- NO 4byte fetch — the second LLM is the decoder, not the MCP. Coupling
  the MCP to a decode output would defeat the out-of-band property.

### `src/signing/blocks.ts` (+57 lines APPEND-ONLY)

`PASTEABLE_BLOCK_TEMPLATE` — 32 lines of joined text with 6 substitution
slots:

```
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

Existing 19 templates (Phase 4 + Phase 6 + Phase 7 + Phase 8 + Plan 08-04 +
Plan 09-02) BYTE-FROZEN. `git diff origin/main -- src/signing/blocks.ts |
grep '^-'` returns zero deletions.

Unicode `‖` (U+2016 DOUBLE VERTICAL LINE) in Step 5 — matches the
convention in `src/signing/payload-fingerprint.ts` documentation +
REQUIREMENTS.md PREP-03 preimage notation. Preserved via TypeScript
string-literal handling (Test 18).

### `test/get-verification-artifact.test.ts` (NEW — 623 lines, 18 cases)

| # | Test | What it locks |
|---|------|---------------|
| 1 | T-PASTEABLE-BYTE-IDENTITY-1 anchor — byte-level fixture (previewed) | Drift in PASTEABLE_BLOCK_TEMPLATE OR substitution logic fails here |
| 2 | Sparse JSON shape (previewed) — toStrictEqual + per-field negative | Sparse-JSON discipline lock |
| 3 | Prepared status — null presignHash JSON + `(not yet previewed)` text | First-state behavior |
| 4 | Sent status — bytes invariant; presignHash non-null | Status-invariance |
| 5 | Cancelled status — bytes invariant | Status-invariance |
| 6 | Demo-mode refusal — DEMO_MODE_REFUSED + isError | Mirror of get_tx_verification Test 3 |
| 7 | HANDLE_NOT_FOUND — unknown handle | Lookup miss branch |
| 8 | HANDLE_EXPIRED — past 15-min TTL via vi.useFakeTimers | TTL eviction branch |
| 9 | HANDLE_TTL_MS constant inheritance — `=== 15 * 60 * 1000` | Single-SOT lock for TTL |
| 10 | ERC-20 transfer selector — `0xa9059cbb` | Selector population for contract calls |
| 11 | Native-send selector null — data === `"0x"` | Selector null for native |
| 12 | Aave-supply 266-char calldata single-line | T-LONG-CALLDATA-WRAPPING-1 v1.3 scope lock |
| 13 | valueWei serialized as string (typeof === `"string"`) | JSON-safe bigint→string |
| 14 | payloadFingerprint regex `/^0x[a-f0-9]{64}$/` | Hex shape |
| 15 | `>>>>` open marker presence (80 chars startsWith) | A7 verify-phase emission lock |
| 16 | `<<<<` close marker presence (80 chars endsWith) | A7 verify-phase emission lock |
| 17 | Canned prompt structure — 5 steps + halt directive | Audience-design lock |
| 18 | Unicode U+2016 (`‖`) preservation | TypeScript string-literal handling |

## pasteableBlock template byte-shape

32 lines, joined with `"\n"`. Total post-substitution length for the
Fixture A native-send case: 1,460 bytes (no calldata bytes). Length scales
linearly with `data` length — for the Aave V3 supply case (266 hex chars +
"0x" prefix already counted), the data line is 286 chars on a single line;
total block length ≈ 1,672 bytes.

Open marker: 80 × `>`. Close marker: 80 × `<`. No fenced code block — the
bare markers are the v1.3 design (A7 backup plan is a single-template-edit
to fenced code block if verify-phase reveals chat-client stripping).

## sparse JSON shape

```typescript
{
  to: Address,                    // viem checksum-cased; e.g. "0x7099...79C8"
  valueWei: string,               // bigint → decimal string; e.g. "1000000000000000000"
  data: Hex,                      // verbatim record.tx.data; e.g. "0x" or "0xa9059cbb..."
  chainId: number,                // viem ChainId; e.g. 1
  payloadFingerprint: Hex,        // 0x + 64 hex chars (32-byte keccak)
  presignHash: Hex | null,        // null on prepared; populated on previewed/sent/cancelled
  selector: Hex | null,           // null for native; "0xXXXXXXXX" for contract calls
}
```

NO `previewToken` / `nonce` / `gas` / `maxFeePerGas` / `maxPriorityFeePerGas`
/ `fourbyte` / `status` / `handle` / `txHash` / `broadcastedAt` /
`cancelledAt` — those fields belong to `get_tx_verification`'s status-aware
re-emit surface. Sparse-JSON discipline is the design lock: the agent
should be incentivized to PASTE the block, not re-emit the JSON.

## register-all coordination note (DEFERRED to Plan 09-05)

Per PATTERNS.md § 3 lines 568-585 + § 8 line 723, the `register-all.ts`
import line for `./get_verification_artifact.js` is OWNED by Plan 09-05.
Plan 09-03 ships:

- `src/tools/get_verification_artifact.ts` (the tool file with
  `registerTool(...)` side-effect at module load)
- `src/signing/blocks.ts` (the template)
- `test/get-verification-artifact.test.ts` (18 cases)

Plan 09-05 will add BOTH `./verify_tx_decode.js` AND
`./get_verification_artifact.js` import lines in the same atomic commit
on `src/tools/register-all.ts`, avoiding 09-03 ∥ 09-05 rebase conflict.

Until Plan 09-05 lands:
- **Production MCP dispatch**: NOT routed to `get_verification_artifact`
  (the tool exists in dist/ but `src/tools/register-all.ts` doesn't
  import it, so the boot-time tool registry doesn't include it).
- **Test code**: `await import("../src/tools/get_verification_artifact.js")`
  fires the `registerTool` side-effect at module load; subsequent
  `getRegisteredTool("get_verification_artifact")` calls return the
  registered tool. All 18 tests work via this seam.

The user-facing impact is zero for v1.3 release since both plans land in
the same milestone. PR description for the 09-03 main-repo PR will name
this coordination explicitly.

## FROZEN-area assertion

All four `git diff origin/main` assertions return zero diff:

| Region | Files | Diff |
|--------|-------|------|
| 12-file cryptographic-binding chain | payload-fingerprint, presign-hash, handle-store, send_transaction, etherscan, fourbyte, aave-v3, erc20, weth9, aave-health, amount, simulation | 0 lines |
| Phase 8 Layer 2 + Plan 09-04 Layer 0.5 | src/tools/preview_send.ts | 0 lines |
| Plan 09-05 register-all carve | src/tools/register-all.ts | 0 lines |
| Existing blocks templates | src/signing/blocks.ts `^-` deletions | 0 lines |

`src/signing/blocks.ts` shows only the additive `PASTEABLE_BLOCK_TEMPLATE`
append (+57 lines insertion-only); existing 19 templates BYTE-FROZEN.

## Test trajectory

| Stage | Test count | Delta |
|-------|------------|-------|
| Baseline (origin/main at e2c1c63 — post-09-02) | 810 | — |
| Post-Plan-09-03 implementation | 828 | +18 |

Plan estimate was 15-25 new tests; landed at exactly 18 (matches plan
estimate of `tests_added_estimate: 18` in frontmatter). Zero pre-existing
tests regressed. `npm run typecheck` + `npm run build` clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — TypeScript-strict mismatch] StructuredError envelope shape vs ToolHandlerResult.structuredContent**

- **Found during:** Task 1 implementation, first `npm run typecheck` after writing the tool file.
- **Issue:** Initial draft imported `makeStructuredError` from `src/signing/error-codes.ts` for the demo-mode + lookup-miss envelopes. TypeScript rejected the return type — `ToolHandlerResult.structuredContent` requires `Record<string, unknown>`, and the `StructuredError` interface (lines 79-83 of error-codes.ts) lacks an index signature. Error:
  ```
  Type 'StructuredError' is not assignable to type 'Record<string, unknown>'.
    Index signature for type 'string' is missing in type 'StructuredError'.
  ```
- **Fix:** Reverted to direct object literals matching the in-tree `get_tx_verification.ts` pattern at lines 86 / 100 / 142: `{ errorCode: "DEMO_MODE_REFUSED", message: "..." }`. This is the conventional shape every Phase 4 signing-flow tool uses. No architectural drift; the alternative (lifting StructuredError to extend Record<string, unknown>) would ripple to 12+ call sites — out of scope here.
- **Files modified:** `src/tools/get_verification_artifact.ts` (single file; reverted the `makeStructuredError` import + replaced 2 `makeStructuredError(...)` calls with direct object literals).
- **Commit:** rolled into the single Task 1 atomic commit (no separate fix commit).

### Plan body's LookupResult interface sketch ≠ in-tree FROZEN type

- The plan body's `<interfaces>` block (lines 122-124) sketched `LookupResult` as a discriminated union on `kind: "found" | "not-found" | "expired"`. The actual in-tree type at `src/signing/handle-store.ts:105-107` discriminates on `ok: true/false`. Followed the in-tree shape (which is the FROZEN type from Plan 04-01) and pulled `errorCode` off the failure arm directly. This is documentation drift in the plan, not a contract change; zero impact.

### `_resetSkillIntegrityForTesting` / `_resetCanonicalDispatchForTesting` not called

- Plan 09-03 doesn't touch the Phase 9 skill-integrity or canonical-dispatch surfaces (Plans 09-02 + 09-04 own those). Zero risk of test crosstalk; the test file matches the simpler beforeEach pattern from `test/get-tx-verification.test.ts` (reset handle-store + demo-mode + active-persona). Full vitest suite green: 810 → 828 (+18), zero pre-existing test regressions.

## Hooks for Plan 09-05

When executing Plan 09-05:

1. **`src/tools/register-all.ts` consolidated import** (line region 25-26 per RESEARCH § Topic 9): add BOTH
   ```typescript
   import "./verify_tx_decode.js";
   import "./get_verification_artifact.js";
   ```
   in the same commit. Plan 09-05 owns both lines.

2. **`verify_tx_decode` tool description routing**: when `verify_tx_decode` returns a `decode-unsupported` envelope (selector unknown to the in-tree decoder), the tool description SHOULD reference `get_verification_artifact` as the second-LLM fallback path — "Use `get_verification_artifact` for an out-of-band second-LLM decode when this server-side cross-check doesn't cover the selector."

3. **Test-side import idempotency**: Plan 09-05's `verify_tx_decode` tests can co-exist with Plan 09-03's tests in the same vitest process — both register their respective tools via the side-effect import at module load. The `registerTool` registry throws on duplicate registration; vitest's module isolation between test files prevents this.

## Accepted Residuals (verify-phase tasks)

- **A7 — chat-client marker preservation**: Tests 15+16 assert the `>>>>` / `<<<<` markers are EMITTED by this tool; whether chat clients (Claude desktop, Cursor, Claude Code CLI, claude.ai) preserve them at render time is a verify-phase smoke task. Backup plan if a major client strips them: switch to fenced code block (triple-backtick) with markers INSIDE — single-template-edit, ships in v1.3.1 hotfix.
- **A8 — second-LLM decode reliability**: Verify-phase smoke across 3-4 LLMs (Claude / GPT / Gemini) for the 5 v1.3-covered actions (transfer / approve / withdraw / supply / aave-withdraw). Steps 1-4 of the canned prompt are LOAD-BEARING (decode bytes); Step 5 (keccak recompute) is RECOMMENDED but not load-bearing — some LLMs refuse to compute keccak without tools, in which case the user falls back to `verify_tx_decode` from Plan 09-05 (server-side decode) + the PREP-08 fingerprint re-check at send-time on the FROZEN three-gate.

## Cross-references

- Closes **SEC-34** (REQUIREMENTS.md): "`get_verification_artifact({ handle })` returns sparse JSON for second-LLM cross-verification, with `pasteableBlock` between explicit copy markers; canned prompt instructs the second LLM to decode bytes from scratch with no shared context."
- Mitigates **T-COORDINATED-AGENT-COMPROMISE-1** (HIGH defense-in-depth) — coordinated agent compromise where args AND narrative are both tampered.
- Mitigates **T-PASTEABLE-BYTE-IDENTITY-1** (HIGH) via Test 1 byte-level fixture.
- Mitigates **T-A7-MARKER-PRESERVATION-1** (MEDIUM, verify-phase) via Tests 15+16 emission assertion + A7 backup plan.
- Defense-in-depth complement to: **Plan 09-01** (skill bootstrap), **Plan 09-02** (skill integrity SHA pin), **Plan 09-04** (canonical-dispatch refusal — Wave B parallel; not yet merged at execute time but blocks.ts append happens AFTER the eventual 09-04 DISPATCH_TARGET_REFUSAL_TEMPLATE region at merge time per APPEND-ONLY end-of-file discipline), **Plan 09-05** (inline `verify_tx_decode` server-side cross-check).

## Self-Check: PASSED

- File `src/tools/get_verification_artifact.ts` exists (138 lines).
- File `test/get-verification-artifact.test.ts` exists (623 lines, 18 tests green).
- File `src/signing/blocks.ts` modified (+57 lines APPEND-ONLY; zero deletions).
- Commit `4999e3b` exists in `git log` (feat(09-03): get_verification_artifact + pasteableBlock + canned second-LLM prompt).
- FROZEN-area assertions all return zero diff.
- `npm run typecheck && npm run build && npm test` all green; 76 test files, 828 tests passing.
