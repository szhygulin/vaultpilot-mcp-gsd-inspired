---
phase: 10
plan: 04
subsystem: "src/tools/request_capability.ts NEW + src/security/request-capability-rate-limit.ts NEW (3rd occupant of src/security/ shelf — Phase 9 first occupants byte-frozen) + APPEND-ONLY register-all.ts import + APPEND-ONLY RATE_LIMIT_EXCEEDED in error-codes.ts (19 -> 20 codes)"
tags: [request-capability, dist-43, sliding-window-rate-limit, urlsearchparams, whatwg, body-cap-7kb, truncation-to-local-file, never-auto-submits, agent-routing-prompt, t-capability-auto-submit-1, t-capability-injection-1, t-capability-body-cap-1, t-capability-spam-1, t-capability-rate-limit-1, _rateLimit-spy-affordance, phase-9-skill-integrity-mirror, append-only-error-codes, append-only-register-all, phase-10, wave-1, v1.4]
requirements: [DIST-43]
wave: 1
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "Phase 9 src/security/skill-integrity.ts + src/security/canonical-dispatch.ts shelf (analog for _rateLimit spy-affordance shape — mirror)"
    - "Phase 9 src/signing/error-codes.ts ErrorCode union (19 entries through DECODE_DIVERGENCE — Plan 10-04 APPEND-ONLY adds 20th)"
    - "Phase 1-9 src/tools/register-all.ts import list (APPEND-ONLY at end-of-list after get_ledger_device_info.js)"
    - "Phase 4 src/signing/error-codes.ts makeStructuredError(code, message, cause?) signature — Plan 10-04 passes retryAfterMs as cause"
    - "Phase 1 src/tools/index.ts registerTool(name, description, inputSchema, handler) signature + ToolInputSchema / ToolHandlerResult types"
    - "package.json zod ^4.4.3 dependency (present from Plan 10-03 — Plan 10-04 inherits, adds no new dep)"
    - "main HEAD ee151d6 (Phase 10 Plans 10-01 + 10-03 already landed)"
  provides:
    - "src/tools/request_capability.ts NEW (~155 LOC; MCP-registered request_capability({title, body}) tool; URL builder via URLSearchParams; 7KB body cap with truncation-to-local-file fallback; DESCRIPTION names \"NEVER auto-submits\" literal per DIST-43 lock; gate-then-record rate-limit discipline via _rateLimit indirection; refusal via makeStructuredError(\"RATE_LIMIT_EXCEEDED\", message, retryAfterMs.toString()))"
    - "src/security/request-capability-rate-limit.ts NEW (~100 LOC; sliding-window 3-per-hour rate-limit; module-scoped timestamps: number[]; HOUR_MS + LIMIT = 3; check() prune-then-test discipline; record() pushes Date.now(); _rateLimit = {check, record} ESM spy-affordance per CLAUDE.md; _resetForTesting() exported)"
    - "src/tools/register-all.ts APPEND-ONLY import \"./request_capability.js\" at end-of-list (33rd entry; side-effect register)"
    - "src/signing/error-codes.ts APPEND-ONLY RATE_LIMIT_EXCEEDED (20th code) + producer-map comment-block extension naming Plan 10-04 + per-process restart caveat"
    - "test/request-capability-rate-limit.test.ts NEW — 10 cases covering T-CAPABILITY-SPAM-1 anchor + sliding-window mechanics + _resetForTesting + ESM spy round-trip + retryAfterMs accuracy + non-monotonic clock edge"
    - "test/request-capability.test.ts NEW — 15 cases covering T-CAPABILITY-INJECTION-1 + T-CAPABILITY-BODY-CAP-1 + T-CAPABILITY-AUTO-SUBMIT-1 + happy path + Zod input rejection + rate-limit pass/refuse + emoji/multiline body round-trip"
  affects:
    - "No FROZEN-area touches. Plan 10-04 is fully additive — Phase 1-9 cryptographic-binding chain + Phase 9 src/security/{skill-integrity,canonical-dispatch}.ts + Phase 10 Plan 10-01 binary build pipeline + Phase 10 Plan 10-03 src/cli/ shelf all BYTE-FROZEN."
  unblocks:
    - "Plan 10-02 install.sh + install.ps1 — no coupling to Plan 10-04; install scripts are independent additive surface in repo root + .github/workflows/"
    - "v1.4 GA closeout — Phase 10 Wave 1 complete (10-01 + 10-03 + 10-04 merged); Wave 2 (10-02) is the final v1.4 plan"
tech-stack:
  added:
    - "No new package.json dependencies. zod (^4.4.3) already present from Plan 10-03; URLSearchParams + node:fs/promises + node:os + node:path are Node built-ins."
  patterns:
    - "ESM spy-affordance indirection per CLAUDE.md Convention — `_rateLimit = { check, record }` wraps the internal-call surface so `vi.spyOn(_rateLimit, ...)` intercepts at consumer call sites (the `request_capability` tool handler calls `_rateLimit.check()` not `check()` directly). Mirror of Phase 9 `_skillIntegrity = { checkSkillIntegrity }` + `_canonicalDispatch = { ... }` shape. Without indirection, ESM named-export immutability makes a direct `vi.spyOn(check)` a silent no-op for internal cross-export calls. Added at write time (not retroactively) per CLAUDE.md."
    - "Sliding-window 3-per-hour rate-limit. `check()` prunes entries older than 1 hour via `timestamps.filter((t) => now - t < HOUR_MS)` BEFORE the length check (prune-then-test discipline). Sliding window prevents the 6-in-2-min burst-at-boundary that a fixed-window (0-60 / 60-120 min buckets) allows — a user could call 3 at minute 59 + 3 at minute 61 under fixed-window. Cost: one filter per check, trivial. Per RESEARCH § Topic 8 line 823 lock."
    - "Gate-then-record discipline. `check()` is PURE — peek without mutate — so consumers can call it speculatively (e.g. UI preview of rate-limit state) without polluting the counter. `record()` runs ONLY after a passing gate AND after the caller commits to the request. Refusal path skips `record()` (Case 9 of `request-capability.test.ts` asserts this — no slot consumed on miss). Different shape from Phase 9 `_skillIntegrity` (cache + cache-clear-on-reset) but same spy-affordance pattern."
    - "URL build via WHATWG `URLSearchParams` (Node built-in). Hand-rolled `encodeURIComponent` chains miss `&` / `=` inside body params, allowing query-param injection (a body containing `&labels=admin-only` would escape the body param and corrupt the URL query — T-CAPABILITY-INJECTION-1). `URLSearchParams` encodes `&` as `%26` correctly per WHATWG percent-encoding spec, and round-trips multiline bodies + multi-byte unicode + emoji byte-for-byte. Test Case 4 anchors via `new URL(url).searchParams.get('body') === originalBody` assertion."
    - "7KB body cap with truncation-to-local-file fallback. Over-cap bodies: (a) generate ISO timestamp (filesystem-safe via `replace(/[:.]/g, \"-\")`) + write FULL text to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` with title H1 + trailing newline; (b) truncate URL body to `body.slice(0, BODY_LIMIT) + '\\n\\n[...truncated; full text at <localFilePath>]'`; (c) surface `localFilePath` in `structuredContent` + human-readable text response. The truncation marker IS the user-recovery instruction — visible INSIDE the GitHub issue body (so the issue itself names where the full text lives) AND in the text response. The local-file fallback IS the design, not a feature flag. T-CAPABILITY-BODY-CAP-1 mitigation."
    - "DESCRIPTION-as-agent-routing-prompt. The DESCRIPTION literal includes `\"NEVER auto-submits\"` per CLAUDE.md `Tool descriptions are agent routing prompts` Convention. Without this phrase, an LLM agent with web-fetch tools (an MCP client that ships `fetch` as a tool) could plausibly POST to the GitHub REST API on the user's behalf, defeating the manual-click-by-user design. T-CAPABILITY-AUTO-SUBMIT-1 mitigation — the MCP server has no visibility into the agent's other tool calls; defense is upstream prompt-engineering. Test Case 6 anchors via `tool.description.includes(\"NEVER auto-submits\")` literal substring match — drift catches at PR-review time."
    - "APPEND-ONLY discipline on FROZEN unions (PATTERNS.md § 1 line 51 + RESEARCH § Topic 10 line 1040). `error-codes.ts` `ErrorCode` union grows 19 -> 20 via single literal appended at end (`| \"RATE_LIMIT_EXCEEDED\"`). `register-all.ts` import list grows 32 -> 33 via single side-effect import appended at end. APPEND-ONLY avoids merge collisions if multiple plans race — ordering doesn't matter functionally (each `registerTool()` runs as a side effect at module load; error-codes are referenced by string literal)."
    - "post-record remaining surfaced in response. `check()` returns the pre-record count (it's pure peek); the response surfaces `Math.max(0, limit.remaining - 1)` so the user sees \"after this call, N calls remain\". Cleaner UX than surfacing the gate's pre-record view; matches the user's mental model (\"I just used one\")."
key-files:
  created:
    - "src/tools/request_capability.ts (NEW — 155 LOC; MCP-registered tool; Zod input + URLSearchParams URL build + 7KB body cap + local-file fallback + gate-then-record rate-limit)"
    - "src/security/request-capability-rate-limit.ts (NEW — 100 LOC; sliding-window 3/hour rate-limit; module-scoped timestamps; _rateLimit spy-affordance; _resetForTesting)"
    - "test/request-capability.test.ts (NEW — 15 cases; T-CAPABILITY-INJECTION-1 + T-CAPABILITY-BODY-CAP-1 + T-CAPABILITY-AUTO-SUBMIT-1 anchors)"
    - "test/request-capability-rate-limit.test.ts (NEW — 10 cases; T-CAPABILITY-SPAM-1 anchor + sliding-window proof via vi.useFakeTimers)"
    - ".planning/phases/10-distribution-and-ergonomics/10-04-SUMMARY.md (this file)"
  modified:
    - "src/tools/register-all.ts (+1 line additive — APPEND `import \"./request_capability.js\";` at end-of-list after get_ledger_device_info.js)"
    - "src/signing/error-codes.ts (+11 lines additive — +10-line producer-map comment block naming Plan 10-04 + per-process restart caveat; +1 union literal `| \"RATE_LIMIT_EXCEEDED\"` at end of ErrorCode discriminated union. Existing 19 codes byte-frozen)"
decisions:
  - "**DESCRIPTION includes literal `\"NEVER auto-submits\"` (DIST-43 lock + CLAUDE.md `Tool descriptions are agent routing prompts`).** The DESCRIPTION IS the agent routing prompt; the MCP server has no visibility into the agent's other tool calls. Defense is upstream prompt-engineering. Test Case 6 (`request-capability.test.ts`) anchors via `tool.description.includes(\"NEVER auto-submits\")` literal substring match — drift catches at PR-review time. T-CAPABILITY-AUTO-SUBMIT-1 mitigation."
  - "**Sliding-window > fixed-window (RESEARCH § Topic 8 line 823 lock).** A fixed-window (0-60 / 60-120 min buckets) lets a user burst 3 at min 59 + 3 at min 61 = 6 in 2 min. Sliding-window prevents this — oldest call falls out of the window only after a FULL 60 min from THAT call's timestamp. Cost: one filter per `check()`, trivial. Test Case 2 (`request-capability-rate-limit.test.ts`) anchors via `vi.useFakeTimers()` + `vi.setSystemTime(t0)` for 3 records, then `vi.setSystemTime(t0 + 60*60*1000 + 1)` — oldest entry falls out; 4th `check()` returns `allowed: true, remaining: 1`."
  - "**Per-process + in-memory rate-limit; restart resets counter** (Assumption A5 documented residual — RESEARCH § Topic 8 line 825 lock). The bypass cost (restart MCP server, lose all session state including paired Ledger session-topic) is high enough to deter casual abuse. Friction-not-fortress. Persistent rate-limit (write timestamps to `~/.vaultpilot-mcp/request-capability-history.json` with file-locking) is YAGNI for v1.4. SECURITY.md row owned by Plan 10-01 documents the residual."
  - "**URLSearchParams (WHATWG) URL build, NOT hand-rolled `encodeURIComponent` chains** (RESEARCH § Topic 8 line 856 Pitfall avoidance + T-CAPABILITY-INJECTION-1 mitigation). Hand-rolled chains miss `&` / `=` inside body params, allowing query-param injection (a body containing `&labels=admin-only` would escape the body param and corrupt the URL query). `URLSearchParams` encodes `&` as `%26` correctly per WHATWG percent-encoding spec, and round-trips multiline bodies + multi-byte unicode + emoji byte-for-byte. Test Case 4 (`request-capability.test.ts`) anchors via `new URL(url).searchParams.get('body') === originalBody` assertion against a hostile-body fixture containing `& = newlines emoji unicode + literal injection attempt`."
  - "**7KB body cap with truncation-to-local-file fallback** (RESEARCH § Topic 8.2 lines 832-854). GitHub's 414 URI Too Long starts at approximately 8KB; 7KB leaves ~700+ chars headroom for title + `labels=capability-request` + base URL + URL-encoding expansion. Over-cap bodies: (a) write FULL text to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` with title H1; (b) truncate URL body with `[...truncated; full text at <localFilePath>]` marker — the marker IS the user-recovery instruction (visible inside the GitHub issue AND in the text response). The local-file fallback IS the design, NOT a feature flag. T-CAPABILITY-BODY-CAP-1 mitigation. Test Case 5 anchors via 10KB body assertion."
  - "**`_rateLimit` ESM spy-affordance mirror of Phase 9 `_skillIntegrity` + `_canonicalDispatch` shape** (PATTERNS.md § 2 lines 118-124). Module-scoped state + indirect-access object + `_resetForTesting()` mirrors Phase 9 `_resetSkillIntegrityForTesting()`. Different value type (array of timestamps instead of cached union-state object) but same structural pattern. 3rd occupant of `src/security/` shelf — Phase 9 first occupants (skill-integrity.ts + canonical-dispatch.ts) byte-frozen."
  - "**`error-codes.ts` 19 -> 20 codes** (RATE_LIMIT_EXCEEDED appended). APPEND-ONLY at end of FROZEN ErrorCode discriminated union; producer-map comment-block extended naming Plan 10-04 as producer + per-process restart caveat (Assumption A5 documented residual). Exhaustive `switch` over `ErrorCode` in any consumer fails to typecheck if the new code isn't handled — surfaces omission at PR-review time per Phase 4 lock at error-codes.ts:1-9 (no such consumers exist for RATE_LIMIT_EXCEEDED in this plan; the producer is the tool handler itself which uses `makeStructuredError`)."
  - "**Post-record `remaining` surfaced in response, not the pre-record gate count.** `check()` is pure peek (returns the count BEFORE the call would consume a slot); the response surfaces `Math.max(0, limit.remaining - 1)` so the user sees \"after this call, N calls remain\" (matches the user's mental model — \"I just used one\"). Test Case 1 asserts `rateLimitRemaining: 2` after the first call (which consumed 1 slot from the initial 3); Case 8 asserts a spy returning pre-record `remaining: 2` surfaces as response `rateLimitRemaining: 1`."
  - "**Gate-then-record split** — `check()` is pure, `record()` mutates. Refusal path skips `record()`. Test Case 9 asserts: pre-load 3 records via `_rateLimit.record()` x3, spy `_rateLimit.record`, call the tool → refusal envelope returned AND `record` spy was NOT called. This is the load-bearing invariant — a check-that-mutates would consume a slot on every refusal, locking the counter forever."
metrics:
  duration: "~12 minutes (single execution wave; 2 test-iteration fixes for response-shape semantics; zero deviations beyond test-side adjustments — Case 1 `rateLimitRemaining: 2` post-record vs pre-record check, Case 5 body-cap upper bound widened from 7100 -> 7500 chars to absorb per-test tmp-path length)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 5 (2 NEW src + 2 NEW test + this SUMMARY)
  files_modified: 2 (src/tools/register-all.ts +1 line + src/signing/error-codes.ts +11 lines additive)
  files_deleted: 0
  tests_before: 945
  tests_after: 970
  tests_delta: "+25 (request-capability 15 + request-capability-rate-limit 10 = 25 NEW; matches plan estimate of 25)"
  loc_delta: "+~255 LOC across 2 NEW src files (~155 in request_capability.ts + ~100 in request-capability-rate-limit.ts); +12 lines additive across 2 modified src files; +~400 LOC across 2 NEW test files (25 cases)"
  frozen_diff_lines: 0 (FROZEN-area zero-diff assertion — git diff origin/main against ALL src/signing/* except additive RATE_LIMIT_EXCEEDED in error-codes.ts + ALL src/tools/prepare_*/preview_send/send_transaction/verify_tx_decode/get_verification_artifact/get_tx_verification + ALL src/protocols/* + src/security/skill-integrity.ts + canonical-dispatch.ts + src/wallet/session-manager.ts + src/chains/registry.ts + src/config/{contracts,env,config-file}.ts returns ZERO lines)
---

# Phase 10 Plan 04: `request_capability` Tool + Sliding-Window 3/Hour Rate-Limit Summary

Wave 1 of Phase 10 — fourth and final Wave 1 plan of the Distribution + Ergonomics milestone. Closes DIST-43 (`request_capability({ title, body })` produces a pre-filled GitHub issue URL; rate-limited 3/hour; no auto-submit by default). Ships 2 NEW src files (`src/tools/request_capability.ts` + `src/security/request-capability-rate-limit.ts`) + 2 ADDITIVE src modifies (`register-all.ts` APPEND import + `error-codes.ts` APPEND 20th code) + 2 NEW test files (25 cases — matches plan estimate). DESCRIPTION includes literal `"NEVER auto-submits"` per CLAUDE.md `Tool descriptions are agent routing prompts` + DIST-43 lock — the load-bearing agent-routing-prompt phrase that prevents an LLM with web-fetch tools from POSTing to GitHub on the user's behalf. URLSearchParams (WHATWG) URL build (T-CAPABILITY-INJECTION-1 mitigation — hostile body `& = newlines emoji unicode + literal injection attempt` round-trips byte-for-byte). 7KB body cap with truncation to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` for manual paste (T-CAPABILITY-BODY-CAP-1 — the truncation marker IS the user-recovery instruction). Sliding-window > fixed-window prevents 6-in-2-min burst-at-boundary (T-CAPABILITY-SPAM-1 — proven via `vi.useFakeTimers` at Case 2). `_rateLimit` ESM spy-affordance mirrors Phase 9 `_skillIntegrity` + `_canonicalDispatch` shape (PATTERNS.md § 2 lines 118-124 — 3rd occupant of `src/security/` shelf). Test trajectory 945 → 970 (+25).

## What Shipped

### 1. `src/tools/request_capability.ts` (NEW — 155 LOC)

MCP-registered tool with Zod input (`title: z.string().min(5).max(120)` + `body: z.string().min(20)`). DESCRIPTION is 5-bullet form including the load-bearing literal `"NEVER auto-submits"` per CLAUDE.md `Tool descriptions are agent routing prompts` + DIST-43 lock (test/request-capability.test.ts Case 6 asserts the literal substring presence — drift catches at PR-review time).

Handler shape:

1. **Zod input validation** via `safeParse`. Invalid input → `INVALID_INPUT` envelope (NOT a throw — the dispatcher boundary expects structured responses).
2. **Rate-limit gate FIRST** via `_rateLimit.check()` BEFORE any URL build / disk write. Refusal path returns `RATE_LIMIT_EXCEEDED` envelope with `cause: retryAfterMs.toString()`; gate-then-record discipline means `record()` is NOT called on refusal (Case 9 anchors).
3. **URL build via `URLSearchParams`** (WHATWG-compliant). URL shape: `https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/new?title=<encoded>&body=<encoded>&labels=capability-request`. Hostile body `&labels=admin-only` is encoded as `%26labels=admin-only` — does NOT add a second labels param (Case 4 asserts via `new URL(url).searchParams.getAll("labels") === ["capability-request"]`).
4. **7KB body cap with truncation-to-local-file fallback**: bodies over `BODY_LIMIT = 7000` get the full text written to `~/.vaultpilot-mcp/capability-requests/<ISO-timestamp>.md` (with `:` and `.` replaced by `-` for Windows filesystem safety) + URL body truncated with `[...truncated; full text at <localFilePath>]` marker. The marker IS the user-recovery instruction — visible inside the GitHub issue body AND in the text response (Case 5 anchors via 10KB body assertion).
5. **Response shape**: `{ url, bodyTruncated, localFilePath, rateLimitRemaining }` in `structuredContent`; human-readable text response surfaces the URL + truncation note (if applicable) + remaining count.

### 2. `src/security/request-capability-rate-limit.ts` (NEW — 100 LOC; 3rd occupant of `src/security/` shelf)

Sliding-window 3-per-hour rate-limit. Module-scoped `timestamps: number[]` array; `HOUR_MS = 60 * 60 * 1000`; `LIMIT = 3`.

```typescript
export function check(): RateLimitResult {
  const now = Date.now();
  timestamps = timestamps.filter((t) => now - t < HOUR_MS);  // prune-then-test
  if (timestamps.length >= LIMIT) {
    const oldest = timestamps[0]!;
    return { allowed: false, remaining: 0, retryAfterMs: HOUR_MS - (now - oldest) };
  }
  return { allowed: true, remaining: LIMIT - timestamps.length, retryAfterMs: 0 };
}

export function record(): void { timestamps.push(Date.now()); }

export const _rateLimit = { check, record };  // ESM spy-affordance
export function _resetForTesting(): void { timestamps = []; }
```

Mirror of Phase 9 `src/security/skill-integrity.ts` + `src/security/canonical-dispatch.ts` ESM spy-affordance shape per CLAUDE.md Convention — `vi.spyOn(_rateLimit, "check")` / `vi.spyOn(_rateLimit, "record")` intercepts at consumer call sites (the tool handler calls `_rateLimit.check()` not `check()` directly). Without the indirection, ESM named-export immutability makes a direct `vi.spyOn(check)` a silent no-op.

**Sliding-window > fixed-window** (RESEARCH § Topic 8 line 823 lock): a fixed-window (0-60 / 60-120 min buckets) lets a user burst 3 at minute 59 + 3 at minute 61 = 6 in 2 min. Sliding-window prevents this — oldest call falls out only after a FULL 60 min from THAT call's timestamp. Test Case 2 (`request-capability-rate-limit.test.ts`) proves via `vi.useFakeTimers()` + `vi.setSystemTime(t0)` for 3 records, then `vi.setSystemTime(t0 + 60*60*1000 + 1)` — oldest entry falls out; 4th `check()` returns `allowed: true, remaining: 1`.

**Per-process + in-memory; restart resets counter** (Assumption A5 documented residual — SECURITY.md row owned by Plan 10-01). The bypass cost (restart MCP server, lose paired Ledger session-topic) is high enough to deter casual abuse — friction-not-fortress.

### 3. `src/tools/register-all.ts` (MODIFY — APPEND-ONLY)

```diff
 import "./get_vaultpilot_config_status.js";
 import "./get_ledger_device_info.js";
+import "./request_capability.js"; // Phase 10 Plan 10-04 (DIST-43) — side-effect register
```

Single additive line at end-of-list. Side-effect import — order doesn't matter functionally. APPEND-ONLY discipline per PATTERNS.md § 1 line 51 + RESEARCH § Topic 10 line 1040 avoids merge collisions with future plans.

### 4. `src/signing/error-codes.ts` (MODIFY — APPEND-ONLY; 19 → 20 codes)

```diff
   | "DECODE_DIVERGENCE"
+  | "RATE_LIMIT_EXCEEDED";
```

Plus producer-map comment-block extension (~10 lines):

> `RATE_LIMIT_EXCEEDED — Phase 10 Plan 10-04 (DIST-43) — fires when the 3-per-hour sliding-window rate-limit is exhausted for request_capability. The cause field carries retryAfterMs as a decimal string (agent consumers parse it back to number). Per-process restart resets the counter — Assumption A5 documented residual (friction-not-fortress; bypass cost is restarting the MCP server and losing the paired Ledger session-topic).`

Existing 19 codes byte-frozen. Exhaustive `switch` over `ErrorCode` in any consumer fails to typecheck if RATE_LIMIT_EXCEEDED isn't handled (no such consumers exist in this plan — the producer is the tool handler itself which uses `makeStructuredError`).

## URL Builder — Encoded Examples

**Happy path** (title `"Add Solana support"`, body `"Solana would let me read SPL tokens."`):

```
https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/new?title=Add+Solana+support&body=Solana+would+let+me+read+SPL+tokens.&labels=capability-request
```

**Hostile body** (T-CAPABILITY-INJECTION-1 — body contains `&labels=admin-only`):

```
...?title=...&body=Multiple+paragraphs%0A%0ASpecial+chars%3A+%26+%3D+%3F+%23%0A%0AInjection+attempt%3A+%26labels%3Dadmin-only%26body%3Dspoof&labels=capability-request
```

`%26` (encoded `&`), `%3D` (encoded `=`), `%0A` (encoded newline). The `&labels=admin-only` substring is encoded as `%26labels%3Dadmin-only` — does NOT add a second `labels` param. `new URL(url).searchParams.getAll("labels")` returns `["capability-request"]` (single canonical label).

**Emoji + multi-byte unicode** (body `"🚀 Launch + 中文 + Москва + café"`):

```
...&body=%F0%9F%9A%80+Launch+%2B+%E4%B8%AD%E6%96%87+%2B+%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0+%2B+caf%C3%A9...
```

WHATWG percent-encoded UTF-8 throughout. `new URL(url).searchParams.get("body")` round-trips to the original Unicode string byte-for-byte (Case 15 anchor).

## 7KB Body Cap + Truncation-to-Local-File Behavior

When `body.length > 7000`:

1. ISO timestamp via `new Date().toISOString().replace(/[:.]/g, "-")` (filesystem-safe across POSIX + Windows).
2. `mkdir(~/.vaultpilot-mcp/capability-requests/, { recursive: true })` — idempotent; no race condition under concurrent calls.
3. `writeFile(<dir>/<timestamp>.md, "# <title>\n\n<full body>\n", "utf8")`.
4. URL body becomes `body.slice(0, 7000) + "\n\n[...truncated; full text at <absolute path>]"`.
5. Response `structuredContent`: `{ url, bodyTruncated: true, localFilePath: "<absolute path>", rateLimitRemaining }`.
6. Response text surfaces the truncation note + path so the user can copy-paste from the file as a complete issue body.

The local file gets the title H1 + full body (so the user can copy-paste from the file as a complete issue body, NOT just the over-cap remainder). Test Case 12 anchors via `content.startsWith("# <title>\n\n") && content.endsWith("\n")` assertion.

## Rate-Limit Sliding-Window Mechanics

```
Time:  t0      t0+1s   t0+2s   t0+3s        ...       t0+60m+1ms
       |       |       |       |                       |
       record  record  record  check->REFUSE          check->ALLOW (oldest fell out)
       (1)     (2)     (3)     (retryAfter=HOUR-3s)   (remaining=1)
```

`check()` is PURE (peek without mutate); `record()` is the only mutation. Test Case 8 (`request-capability-rate-limit.test.ts`) asserts prune-then-test ordering — at `t0 + 60m + 1ms`, ALL three entries fall out simultaneously; `check()` returns `{ allowed: true, remaining: 3 }` (in-window count is 0 after prune).

Test Case 9 anchors the gate-then-record discipline at the tool-handler level: pre-load 3 records via `_rateLimit.record()` x3, spy `_rateLimit.record`, call the tool → refusal envelope returned AND `record` spy was NOT called. A check-that-mutates would consume a slot on every refusal, locking the counter forever.

## FROZEN-Area Assertion

`git diff origin/main` against the FROZEN list returns ZERO lines:

- ALL `src/signing/*` (Phases 4/6/7/9 cryptographic-binding chain) UNCHANGED — `payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts`, `blocks.ts`, `aave-health.ts`, `amount.ts`, `simulation.ts`. Only `error-codes.ts` shows additive `RATE_LIMIT_EXCEEDED` + producer-map comment (lines 1-89 byte-frozen; lines 90-91 additive).
- ALL `src/tools/prepare_*.ts` (8 prepare tools — Phases 4/6/7/8) UNCHANGED.
- `src/tools/preview_send.ts`, `src/tools/send_transaction.ts`, `src/tools/verify_tx_decode.ts`, `src/tools/get_verification_artifact.ts`, `src/tools/get_tx_verification.ts` UNCHANGED.
- ALL `src/protocols/*.ts` UNCHANGED.
- `src/security/skill-integrity.ts` + `src/security/canonical-dispatch.ts` (Phase 9 first occupants — Plan 10-04 ADDS `request-capability-rate-limit.ts` as 3rd occupant) UNCHANGED.
- `src/wallet/session-manager.ts`, `src/chains/registry.ts`, `src/config/contracts.ts`, `src/config/env.ts`, `src/config/config-file.ts` UNCHANGED.
- Fixtures A-F (`test/signing-fingerprint.test.ts` hardcoded literals) UNCHANGED — Plan 10-04 doesn't touch the trust pipeline at all.

ONLY FROZEN-area touches: additive `RATE_LIMIT_EXCEEDED` in `error-codes.ts` + additive `import "./request_capability.js"` in `register-all.ts`. Both diffs are end-of-file additive hunks; existing content byte-frozen.

## Test Trajectory: 945 → 970 (+25)

```
Test Files  86 passed (86)
     Tests  970 passed (970)
  Start at  18:37:36
  Duration  8.66s
```

| File | Cases | Anchors |
|------|-------|---------|
| `test/request-capability-rate-limit.test.ts` | 10 | Case 1 — **T-CAPABILITY-SPAM-1 (3 allowed → 4th refused)**; Case 2 — **sliding-window proof via vi.useFakeTimers + vi.setSystemTime**; Cases 3, 6, 7 — `_resetForTesting` + ESM spy round-trips (`vi.spyOn(_rateLimit, "check"/"record")`); Case 4 — `retryAfterMs` accuracy; Case 8 — prune-then-test ordering; Case 10 — non-monotonic clock edge documented |
| `test/request-capability.test.ts` | 15 | Case 4 — **T-CAPABILITY-INJECTION-1 (URLSearchParams round-trip preserves & = newlines emoji unicode byte-for-byte; injection attempt does NOT add a second labels param)**; Case 5 — **T-CAPABILITY-BODY-CAP-1 (10KB body → truncation + local-file write + marker presence)**; Case 6 — **T-CAPABILITY-AUTO-SUBMIT-1 (DESCRIPTION literal substring match for "NEVER auto-submits")**; Cases 7-9 — rate-limit pass/refuse with gate-then-record discipline (refusal does NOT call record); Cases 14, 15 — multiline + emoji body round-trip |

`npm run typecheck` clean. `npm run build` (tsc → `dist/`) clean. Full `npm test` 970 passed (Phase 1-9 + 10-01 + 10-03 baseline 945 + Plan 10-04 +25 = 970). No flaky tests; no test isolation regressions.

## Threat-Coverage Self-Check

| Threat | Severity | Mitigation | Asserted by |
|--------|----------|-----------|-------------|
| **T-CAPABILITY-AUTO-SUBMIT-1** | high (STOP-THE-LINE) | DESCRIPTION literal includes `"NEVER auto-submits"` per CLAUDE.md `Tool descriptions are agent routing prompts` + DIST-43 lock | request-capability Case 6 DESCRIPTION literal substring match |
| **T-CAPABILITY-INJECTION-1** | high | URLSearchParams (WHATWG) encodes `&` as `%26`; hand-rolled chains miss this | request-capability Case 4 — hostile body `& = newlines emoji unicode + literal injection attempt` round-trips byte-for-byte; `getAll("labels") === ["capability-request"]` |
| **T-CAPABILITY-BODY-CAP-1** | high | 7KB body cap + write FULL text to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` + truncation marker `[...truncated; full text at <localFilePath>]` IS the user-recovery instruction | request-capability Case 5 — 10KB body assertion |
| **T-CAPABILITY-RATE-LIMIT-1** | high (STOP-THE-LINE) | `_rateLimit = { check, record }` ESM spy-affordance per CLAUDE.md (mirror of Phase 9 `_skillIntegrity` + `_canonicalDispatch`) | request-capability-rate-limit Cases 6 + 7 — `vi.spyOn(_rateLimit, "check"/"record")` round-trip |
| **T-CAPABILITY-SPAM-1** | medium | Sliding-window 3-per-hour rate-limit; 4th call within 60-min window refused | request-capability-rate-limit Cases 1 + 2 |
| **T-LOCAL-FILE-PATH-CONFLICT-1** | low | ISO millisecond resolution + single-threaded JS event loop makes sub-ms collision nearly impossible | accepted residual (v1.5+ per-pid suffix deferred) |
| **T-FROZEN-SIGNING-1** | high (STOP-THE-LINE) | `git diff origin/main` against FROZEN list returns ZERO lines | execute-time grep against the FROZEN file list (0 lines confirmed) |

## Deviations from Plan

None on the implementation surface. Two test-side adjustments during execution:

- **Case 1 of `request-capability.test.ts`**: initial assertion was `rateLimitRemaining: 3` (the pre-record `check()` count); changed to `rateLimitRemaining: 2` after the tool handler was updated to surface POST-record `remaining` (`Math.max(0, limit.remaining - 1)`). User mental model is "after this call, N calls remain" — cleaner UX than the gate's pre-record view. Case 8 updated correspondingly (spy returns pre-record `remaining: 2` → response surfaces post-record `remaining: 1`).
- **Case 5 body-cap upper-bound widened from 7100 → 7500 chars**: the truncation marker `\n\n[...truncated; full text at <absolute path>]` plus the per-test tmpdir absolute path (~150 chars on macOS) pushed the URL body to ~7170. 7500 is the practical bound that absorbs per-test path length without being so loose it misses a regression where `BODY_LIMIT` silently doubles.

## Hooks for Plan 10-02 (install.sh + install.ps1)

No coupling. Plan 10-02 ships install scripts in repo root + `.github/workflows/release.yml`. Plan 10-04 is fully independent additive surface in `src/tools/` + `src/security/`. Both can land in either order; no merge conflict expected.

## Hooks for v1.4 GA Close-Out

Plan 10-04 is the final Wave 1 plan of Phase 10. After Plan 10-02 lands (Wave 2 — the last Phase 10 plan):

- **v1.4 GA**: first end-to-end install flow (`curl ... | sh` or `npm install -g vaultpilot-mcp` → `vaultpilot-mcp setup` → registered with detected MCP clients → `request_capability` available in the agent's tool surface for capability-gap surfacing).
- **Phase 10 retro**: confirms ROADMAP requirements DIST-39/40/41/42/43 all closed; FROZEN-area zero-diff held across all 4 plans (largest FROZEN-area boundary of any phase to date).
- **v1.5+ planning**: deferred items below.

## Accepted Residuals

- **Per-process rate-limit resets on MCP server restart** (Assumption A5). Bypass cost (restart, lose paired Ledger session-topic) is high enough to deter casual abuse. Friction-not-fortress. SECURITY.md row owned by Plan 10-01 documents this.
- **DESCRIPTION-as-defense for `NEVER auto-submits`** is the only mitigation against an LLM with web-fetch tools POSTing on the user's behalf. The MCP server has no visibility into the agent's other tool calls. Defense is upstream prompt-engineering; T-CAPABILITY-AUTO-SUBMIT-1 mitigation is the DESCRIPTION literal + the DIST-43 lock. v1.x ships this design intentionally; v3.0+ hosted MCP may add per-tool-call audit logging to detect post-hoc bypass.
- **GitHub's 414 threshold is approximately 8KB; 7KB body cap is empirical** (Assumption A6). If GitHub tightens the limit in 2026+, the cap may need to lower. Recovery: lower `BODY_LIMIT` constant — 1-line change.
- **`URLSearchParams.toString()` produces percent-encoded UTF-8 per WHATWG spec** (Assumption A7). Empirically verified in test Cases 14 + 15 (multiline + emoji body round-trip). If a future Node version changes behavior, tests catch at PR-review time.
- **Local-file path collision under sub-millisecond concurrent calls** (T-LOCAL-FILE-PATH-CONFLICT-1, LOW). Single-threaded JS event loop makes this nearly impossible; if it occurs, the FIRST file gets overwritten — acceptable. v1.5+ may add per-pid suffix.
- **`makeStructuredError` `cause` field accepts string** (per Phase 4 signature). Plan 10-04 passes `retryAfterMs.toString()` — agent consumers parse it back to number.
- **Rate-limit precision is `Date.now()` (millisecond)**. Sub-ms calls within the same JS turn share a timestamp; collision-safe under single-threaded event loop. Acceptable.
- **`mkdir` recursive succeeds even when the path already exists** (Node `fs/promises` `{ recursive: true }` is idempotent). No race condition between concurrent `request_capability` calls creating the same directory.

## Deferred (v1.5+ / v3.0+)

- **Per-pid suffix on `<timestamp>.md` local file** — v1.5+ ergonomics (T-LOCAL-FILE-PATH-CONFLICT-1).
- **Persistent rate-limit timestamps** (`~/.vaultpilot-mcp/request-capability-history.json` with file-locking) — v1.5+ if data shows misuse.
- **Custom labels in `request_capability` input** (`labels?: string[]`) — v1.5+ ergonomics; v1.4 ships single `capability-request` label only.
- **Multi-bullet `assignees` / `milestone` params** — v1.5+ ergonomics.
- **Cosign signature on capability-request local file** — v1.5+ scope; aligned with broader sigstore SLSA mitigation path in Plan 10-01.
- **Per-user rate-limit (multi-tenant)** — v3.0+ hosted-MCP scope.
- **`request_capability --execute` flag (with explicit user gh-CLI auth)** — DELIBERATELY OUT OF SCOPE for v1.x. The manual-click-by-user invariant is the DIST-43 lock.
- **Embed an issue template** (`## What chain/protocol/feature` + `## Why it matters` + `## Workaround`) — v1.5+ ergonomics.
- **Per-tool-call audit logging** to detect post-hoc T-CAPABILITY-AUTO-SUBMIT-1 bypass — v3.0+ hosted MCP scope.

## Self-Check: PASSED

- [x] `src/tools/request_capability.ts` exists with: DESCRIPTION literal including `"NEVER auto-submits"` (T-CAPABILITY-AUTO-SUBMIT-1 mitigation); Zod input (title 5-120 chars + body ≥ 20); rate-limit gate via `_rateLimit.check()` BEFORE URL build (gate-then-record discipline); URL build via `URLSearchParams` (WHATWG); 7KB body cap with `mkdir` + `writeFile` to `~/.vaultpilot-mcp/capability-requests/<timestamp>.md` + truncation marker; refusal via `makeStructuredError("RATE_LIMIT_EXCEEDED", message, retryAfterMs.toString())`; `registerTool` invocation
- [x] `src/security/request-capability-rate-limit.ts` exists with: module-scoped `timestamps: number[]`; `HOUR_MS = 60 * 60 * 1000` + `LIMIT = 3`; `check()` (prune-then-test) + `record()`; `_rateLimit = { check, record }` ESM spy-affordance (mirror of Phase 9 `_skillIntegrity` + `_canonicalDispatch`); `_resetForTesting()` exported
- [x] `src/tools/register-all.ts` has additive `import "./request_capability.js";` at end-of-list (APPEND-ONLY)
- [x] `src/signing/error-codes.ts` has `RATE_LIMIT_EXCEEDED` appended to ErrorCode union (19 → 20 codes); producer-map comment-block extended naming Plan 10-04 + per-process restart caveat
- [x] `test/request-capability-rate-limit.test.ts` 10 cases all green (T-CAPABILITY-SPAM-1 + sliding-window proof + `_resetForTesting` + ESM spy round-trip + retryAfterMs accuracy + non-monotonic clock edge)
- [x] `test/request-capability.test.ts` 15 cases all green (T-CAPABILITY-INJECTION-1 URLSearchParams round-trip + T-CAPABILITY-BODY-CAP-1 10KB truncation + T-CAPABILITY-AUTO-SUBMIT-1 DESCRIPTION literal substring match + rate-limit pass/refuse + emoji/multiline body)
- [x] `npm run typecheck` clean
- [x] `npm run build` clean
- [x] `npm test` 970 passed (+25 from 945 baseline; matches plan estimate)
- [x] FROZEN-area assertion: `git diff origin/main` against the FROZEN list returns ZERO lines
- [x] `src/signing/error-codes.ts` byte-frozen assertion: diff shows ONLY additive RATE_LIMIT_EXCEEDED entry + producer-map comment lines
- [x] `src/tools/register-all.ts` byte-frozen assertion: diff shows ONLY additive import line

All Plan 10-04 success criteria met. Phase 10 Wave 1 complete (10-01 + 10-03 + 10-04 all merged with FROZEN-area held); Plan 10-02 (install scripts) is the final Wave 2 plan before v1.4 GA.
