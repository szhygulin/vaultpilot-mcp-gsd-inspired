# Phase 5: Demo mode + diagnostics — Research

**Researched:** 2026-05-12
**Domain:** Runtime-flag resolution, persona registry, in-process diagnostics, npm registry HTTP check
**Confidence:** HIGH (the codebase is the source of truth for everything except DIAG-02's WC probe surface, which is LOW — no canonical method exists)

## Summary

Phase 5 is an **evolution-not-replacement** phase. Phase 3 + Phase 4 already wired the demo-mode predicate at five call sites; Phase 5 expands the predicate body from a one-liner env check to an `env > config > auto-detect` chain, and adds the persona registry + DIAG tools + update check + first-response NOTICE block. The seam is `src/config/env.ts::isDemoMode()` — its signature stays stable, its body grows. Phase 3 + 4's refusal paths (`pair_ledger_live`, `prepare_native_send`, `preview_send`, `get_tx_verification`, `send_transaction`'s simulation envelope) must keep passing their existing tests without one-line modification.

Three load-bearing findings shaped the plan dependency graph:

1. **DIAG-03 is partially done.** `src/server.ts` lines 28–32 + 42 already pass `instructions: INSTRUCTIONS` to the SDK `Server` constructor (Phase 1 shipped this). Phase 5's job is to **verify the text reads correctly post-Phase 4** and optionally rewrite it (the current text predates the prepare → preview → send pipeline shipping). Source: `src/server.ts:28-42`; verified against `@modelcontextprotocol/sdk@1.29.0` types at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:11-15` (`instructions?: string` on `ServerOptions`).
2. **The current `~/.vaultpilot-mcp/config.json` path is already canonical in-tree.** `src/diagnostics/check.ts:96-124` (`checkConfigFile()`) already computes `join(homedir(), ".vaultpilot-mcp", "config.json")`, reads via `readFileSync`, parses JSON, and surfaces `absent` / `malformed`. Plan 05-01's config resolver should **share this path computation** (extract a helper, NOT duplicate the string literal — format-fanout-regex-sync rule).
3. **The "should `prepare_native_send` simulate in demo mode?" question is already answered in-tree, AGAINST simulation.** Line 123 of `src/tools/prepare_native_send.ts` reads: *"Phase 5 lifts this for send_transaction to a simulation envelope; prepare_native_send remains refused."* Same comment shape at `src/tools/preview_send.ts:119`. The authoritative interpretation: **demo mode rehearses READ flows + the simulation envelope; it does NOT rehearse the full prepare → preview → send chain.** `send_transaction`'s demo branch fires only when called against a previously-prepared handle (Phase 4 test 9 seeds `seedPreviewedHandle()` directly via the handle-store API, bypassing the refused `prepare_native_send` call). The plan should preserve this design.

**Primary recommendation:** Plans are **strictly sequential** — 05-01 must land first (it ships the new `isDemoMode()` body + persona registry); 05-02 consumes the persona address; 05-03 consumes the resolved-mode boolean for both NOTICE-emission and DIAG-01. Parallelism would force a planning round-trip when 05-02 needs persona shape before it's locked.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `isDemoMode()` resolution (env > config > auto-detect) | `config/` (process startup) | — | The result is consumed everywhere; the resolver belongs in config, not at any call site |
| Persona registry + `set_demo_wallet` state | `demo/` (process-local module state) | — | Process-local state per DEMO-04; the registry is a const, the active persona is a module-scoped `let` |
| `get_demo_wallet` / `set_demo_wallet` tool handlers | `tools/` | `demo/` | Standard side-effect-import registration pattern (Phase 2+) |
| Demo `from` address wiring on `send_transaction` | `tools/send_transaction.ts` | `demo/personas.ts` | The tool reads the active persona address at simulation time; no new module needed |
| `get_vaultpilot_config_status` | `tools/` | `config/` + `wallet/` (read state) | Surfaces booleans/counts derived from config + WC singleton state |
| `get_ledger_device_info` | `tools/` | `wallet/session-manager.ts` (existing `getStatus`) | Reads what the WC session already exposes; no SDK extension |
| Once-per-session update check | `diagnostics/` (new file `update-check.ts`) | `index.ts` (boot wiring) | Module-local `let fired = false` + fire-and-forget at boot |
| Auto-demo NOTICE block | `src/server.ts` (dispatcher wrap) | `diagnostics/notice.ts` (template) | The first-response intercept lives at the CallToolRequest dispatcher (Phase 4 SDK-gate precedent) |
| DIAG-03 `instructions` field | `src/server.ts` (already wired) | — | Verify-only — Phase 1 shipped this |

## Standard Stack

### Core (already installed — no new dependencies for Phase 5)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.29.0 (installed) | `instructions` field on `Server` constructor (DIAG-03); `CallToolRequest` dispatcher for first-response NOTICE wrap | Already in use; native types support `instructions?: string` |
| `viem` | ^2.48.0 (installed) | `call({ account, to, value, data })` for demo simulation envelope with persona `from` | Already used; `account` is the persona address |
| `node:os` `homedir()` | built-in | Resolve `~/.vaultpilot-mcp/config.json` | Standard, mirrors `src/diagnostics/check.ts:97` |
| `node:fs` `readFileSync` | built-in | Read config file synchronously at boot | Mirrors `src/diagnostics/check.ts:99`; sync is correct (one-shot at boot) |
| `node:path` `join` | built-in | Path-construct config path | Mirrors `src/diagnostics/check.ts:97` |
| `globalThis.fetch` + `AbortController` | Node ≥ 18.17 built-in | Update-check HTTP GET against `registry.npmjs.org` | Confirmed available at `process.version v22.19.0`; `engines.node >= 18.17` per `package.json:26` |

### Supporting
No new packages. Phase 5 ships entirely on the in-tree stack.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sync `readFileSync` at boot | Async `readFile` | Reject: complicates `isDemoMode()` caching (would need `Promise<boolean>` or top-level await); the file is < 1 KB and read once. Sync is simpler and matches `src/diagnostics/check.ts:99` precedent |
| Fire update check on first tool call | Fire at server boot | Reject: tying it to first tool call means it's part of the NOTICE-emission code path; the two should be independent (NOTICE is per-process state; update check is fire-and-forget) |
| New `node-fetch` dep | built-in `fetch` | Reject: Node ≥ 18.17 has `globalThis.fetch`; adding a dep is unjustified |

**Installation:** none — Phase 5 is dependency-free.

**Version verification:** `npm view vaultpilot-mcp version` → `0.14.4` (the UPSTREAM project, not this rebuild). Surfaces as an open risk in § Open Questions Q-NPM (update-check semantics under name collision). Verified 2026-05-12.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌────────────────────────────────────────────────┐
                    │  Phase 5 NEW MODULES (new file paths in green) │
                    └────────────────────────────────────────────────┘

  process.env                          ~/.vaultpilot-mcp/config.json
  VAULTPILOT_DEMO                      { demo?: boolean, ... }
       │                                       │
       └──────────┬────────────────────────────┘
                  ▼
            ┌─────────────────────────────┐
            │  src/config/env.ts          │  Phase 5 EXPANDS the body
            │  isDemoMode()               │  (signature stable)
            │  + new resolveDemoConfig()  │
            │  + new _resetForTesting()   │
            └────────────────┬────────────┘
                             │ (cached at first call)
                             ▼
           ┌──── reads ──────┼────── reads ──────┐
           │                 │                   │
  src/tools/pair_         src/tools/prepare_   src/tools/send_
  ledger_live.ts          native_send.ts       transaction.ts   (Phase 3+4 — UNCHANGED)
  (refuses)               (refuses)            (simulates ── ─ ─┐
                                                                │
  src/tools/preview_      src/tools/get_tx_                     │
  send.ts                 verification.ts                       │
  (refuses)               (refuses)                             ▼
                                                       reads persona address
                                                       from   src/demo/personas.ts
                                                              + active state
                                                              │
                                                              ▼
                                                       eth_call({ account })

  ┌─── Plan 05-01 ────┐  ┌─── Plan 05-02 ────────┐  ┌─── Plan 05-03 ─────┐
  │ src/config/       │  │ src/tools/            │  │ src/tools/         │
  │   demo-resolve.ts │  │   send_transaction.ts │  │   get_vaultpilot_  │
  │ src/demo/         │  │   (1-line edit:       │  │     config_status  │
  │   personas.ts     │  │    pass `account`)    │  │ src/tools/         │
  │ src/tools/        │  │ + integration test    │  │   get_ledger_      │
  │   get_demo_wallet │  │                       │  │     device_info    │
  │ src/tools/        │  │                       │  │ src/diagnostics/   │
  │   set_demo_wallet │  │                       │  │   update-check.ts  │
  │                   │  │                       │  │ src/diagnostics/   │
  │                   │  │                       │  │   notice.ts        │
  │                   │  │                       │  │ src/server.ts      │
  │                   │  │                       │  │   (wrap dispatcher)│
  └───────────────────┘  └───────────────────────┘  └────────────────────┘
                                                              │
                                                              ▼
                                                    boot wiring in
                                                    src/index.ts or
                                                    src/server.ts
                                                    (fire-and-forget
                                                     update check)
```

### Recommended Project Structure
```
src/
├── config/
│   ├── env.ts                # EVOLVED — isDemoMode() body grows; signature stable
│   └── demo-resolve.ts       # NEW — sync resolver + config-file parser + cache
├── demo/                     # NEW directory (already implied by CLAUDE.md architecture diagram)
│   └── personas.ts           # NEW — const PERSONAS array + module-scoped activePersona
├── diagnostics/
│   ├── check.ts              # UNCHANGED — already reads ~/.vaultpilot-mcp/config.json
│   ├── update-check.ts       # NEW — fire-and-forget npm registry GET
│   ├── notice.ts             # NEW — VAULTPILOT NOTICE template (format-fanout sentinel)
│   ├── install-envelope.ts   # UNCHANGED
│   └── logger.ts             # UNCHANGED
├── tools/
│   ├── get_demo_wallet.ts        # NEW
│   ├── set_demo_wallet.ts        # NEW
│   ├── get_vaultpilot_config_status.ts  # NEW
│   ├── get_ledger_device_info.ts        # NEW
│   ├── register-all.ts           # +4 imports
│   └── send_transaction.ts       # 1-line edit at line ~323 — pass `account: <persona>`
├── server.ts                 # OPTIONAL EDIT — wrap CallToolRequest dispatcher to prepend NOTICE on first response
└── index.ts                  # OPTIONAL EDIT — fire update check at boot
```

### Pattern 1: Lazy-singleton with `_resetForTesting()` (matches existing in-tree pattern)
**What:** Module-scoped `let cached: T | undefined` + getter that initializes on first call + test-only reset.
**When to use:** `isDemoMode()`'s evolved body (the resolution chain is cached at first call; subsequent calls hit the cache).
**Example:**
```typescript
// Source: src/chains/ethereum.ts:9-44 (verified in-tree pattern)
let cachedClient: PublicClient | undefined;
let cachedUsedFallback = false;

export function getEthereumClient(): PublicClient {
  if (cachedClient) return cachedClient;
  // ... resolution chain ...
  cachedClient = createPublicClient({ chain: mainnet, transport: http(url) });
  return cachedClient;
}

export function _resetEthereumClientForTesting(): void {
  cachedClient = undefined;
  cachedUsedFallback = false;
  warnedFallback = false;
}
```

Plan 05-01's `isDemoMode()` adopts the identical shape. The cache MUST be process-local so the predicate doesn't re-stat the config file on every signing-flow refusal.

### Pattern 2: Format-fanout sentinel const (NOTICE block + simulation banner)
**What:** Multi-line string is `export const X: string = [...].join("\n")` — tests import the const, substitute placeholders the same way the handler does, and assert `result.content[0].text.includes(substituted)`.
**When to use:** The `VAULTPILOT NOTICE — Auto demo mode active` block (DEMO-07).
**Example:**
```typescript
// Source: src/tools/pair_ledger_live.ts:51-61 (VERIFY_ON_DEVICE_TEMPLATE) — verified in-tree
export const AUTO_DEMO_NOTICE_TEMPLATE: string = [
  "VAULTPILOT NOTICE — Auto demo mode active",
  "",
  "  No config file at ~/.vaultpilot-mcp/config.json and VAULTPILOT_DEMO is unset.",
  "  Booting into demo mode with curated personas. Signing tools refuse;",
  "  read tools work against real RPC against the active persona address.",
  "",
  "  To exit demo mode: set VAULTPILOT_DEMO=false in your env, OR create",
  "  ~/.vaultpilot-mcp/config.json with { \"demo\": false }.",
].join("\n");
```

### Pattern 3: Side-effect-import tool registration (4 new tools)
**What:** Each new tool module's top-level `registerTool(...)` call is the side effect; `register-all.ts` adds an `import` line.
**Source:** `src/tools/register-all.ts` + every existing tool — verified Phase 2 pattern that survived Phases 3 + 4.

### Anti-Patterns to Avoid
- **Per-tool first-response gate** — wrapping each handler with "did NOTICE fire yet?" check duplicates state across N handlers. Wrap the dispatcher in `src/server.ts` instead (Phase 4 `AjvJsonSchemaValidator` precedent: right scope = SDK boundary).
- **Re-reading config.json on every `isDemoMode()` call** — cache the resolved boolean at first call. Defense: signing-flow refusals call `isDemoMode()` once each; in a busy session that's 5+ stat syscalls per tool call.
- **Duplicating `~/.vaultpilot-mcp/config.json` path literal** — `src/diagnostics/check.ts:97` already computes it. Extract a `getConfigPath()` helper in `src/config/demo-resolve.ts` and have `check.ts` import it (format-fanout-regex-sync rule from global CLAUDE.md).
- **`fetch` without `AbortController`** — npm registry GET must use a 2-second `AbortSignal.timeout(2000)` so a slow network doesn't keep the boot hanging.
- **Logging update-check to stdout** — only stderr per CLAUDE.md "Stderr for diagnostics, stdout for MCP protocol" (use `log("info", ...)` from `src/diagnostics/logger.ts`).
- **Refusing `set_demo_wallet` in non-demo mode silently** — return a structured error envelope naming the failure (`WRONG_MODE` or equivalent) so the agent can recover. The contract: `set_demo_wallet` mutates persona state; calling it outside demo mode is an agent bug, not a malicious request — surface it clearly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config-file path resolution | Custom `~/` expansion | `join(homedir(), ".vaultpilot-mcp", "config.json")` | Standard; matches `src/diagnostics/check.ts:97`; cross-platform (Windows: homedir returns `C:\Users\foo`) |
| Update-check HTTP client | `node-fetch` / `axios` / `got` | Built-in `globalThis.fetch` + `AbortSignal.timeout(2000)` | Node ≥ 18.17 native; one less dep |
| JSON-schema validation for new tools | Custom check at top of each handler | Phase 4's `AjvJsonSchemaValidator` at `src/server.ts:55-66` | Already wired — every new tool's `inputSchema` gets validated for free at the protocol boundary |
| Persona address checksumming | Manual upper/lower normalization | `viem.getAddress(...)` — applied AT WRITE TIME inside `personas.ts` so the literal is the checksummed form | EIP-55 correctness; tests can assert byte-identity against the literal |

**Key insight:** Phase 5 introduces no new heavy machinery. Every primitive it needs (config file path, lazy-singleton, side-effect tool registration, schema validation, fetch + timeout, structured error envelopes) has an in-tree precedent. The risk is **not pattern invention** — it's **respecting the seam** so existing tests keep passing.

## Runtime State Inventory

This is an additive phase, not a rename. No data migration required. Each "Stored data" line is checked-and-found-nothing:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `isDemoMode()` cache is module-scoped + reset between processes; persona state is module-scoped | None |
| Live service config | None — no n8n/Datadog/Tailscale; this is a desktop MCP | None |
| OS-registered state | None — no Task Scheduler / launchd / systemd registration in v1.x | None |
| Secrets/env vars | `VAULTPILOT_DEMO` (new semantics for `"false"`; rejection class for other values) + `VAULTPILOT_DISABLE_UPDATE_CHECK=1` (NEW env var) — both READ at boot, no SECRET implications | Document `VAULTPILOT_DISABLE_UPDATE_CHECK` in README + check-doctor output |
| Build artifacts | None — TypeScript compile, no native bindings | None |

**Sentinel concern:** The phase introduces a NEW env var (`VAULTPILOT_DISABLE_UPDATE_CHECK`). It MUST be added to `src/diagnostics/check.ts`'s doctor pass so users discover it during install validation; surface it as a `level: "ok"` `message: "VAULTPILOT_DISABLE_UPDATE_CHECK=1 — update check suppressed"` when set.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEMO-01 | `VAULTPILOT_DEMO=true` literal forces demo | Already in `src/config/env.ts:36-38`; test at `test/pair-ledger-live.test.ts:207` locks strict-literal semantics. Plan 05-01 preserves the literal-`"true"` arm of the new resolution chain |
| DEMO-02 | `VAULTPILOT_DEMO=false` deterministic opt-out | Plan 05-01 adds literal-`"false"` arm; ANY OTHER non-empty value rejects at boot with stderr error + exit (recommendation; see § Open Questions Q-STRICT for alternative) |
| DEMO-03 | `get_demo_wallet` lists 4 personas with addresses + rehearsable flows | Plan 05-01 ships `src/demo/personas.ts` const + `src/tools/get_demo_wallet.ts` |
| DEMO-04 | `set_demo_wallet({ persona })` activates a persona; state process-local | Plan 05-01; module-scoped `let activePersona: Persona \| null = null` mutated by setter |
| DEMO-05 | Demo `send_transaction` runs `eth_call`, returns simulation envelope | ALREADY SHIPPED in `src/tools/send_transaction.ts:318-358`. Plan 05-02 adds **one-line edit** to pass `account: persona.address` to `viem.call(...)` |
| DEMO-06 | Demo `pair_ledger_live` refuses outright | ALREADY SHIPPED in `src/tools/pair_ledger_live.ts:84-99`. Plan 05-02 verifies via existing test; touches NO code |
| DEMO-07 | Brand-new install auto-enters demo; first response carries NOTICE | Plan 05-01 (auto-detect arm) + Plan 05-03 (NOTICE block + first-response intercept at `src/server.ts`) |
| DIAG-01 | `get_vaultpilot_config_status` returns booleans/counts | Plan 05-03; surface listed in § Q-DIAG-01 below |
| DIAG-02 | `get_ledger_device_info` probes Ledger via WC | Plan 05-03; **probe surface unavailable** — see § Q-DIAG-02 below for fallback envelope |
| DIAG-03 | Server `instructions` field carries self-description | PARTIALLY DONE in `src/server.ts:28-42`. Plan 05-03 reviews + optionally rewrites text (post-Phase-4 truth) |
| DIAG-04 | Stderr update check; suppressed by `VAULTPILOT_DISABLE_UPDATE_CHECK=1` | Plan 05-03; `globalThis.fetch` + 2s `AbortSignal.timeout` |
| INST-05 | First-run install auto-demos | Same as DEMO-07; Plan 05-01 auto-detect arm |

## Common Pitfalls

### Pitfall 1: `isDemoMode()` re-evaluation across the same tool call
**What goes wrong:** Two refusal branches in different tools each call `isDemoMode()` during the same session; each call re-stats the config file.
**Why it happens:** The current Phase 3+4 body is `process.env.VAULTPILOT_DEMO === "true"` — trivially cheap. The evolved body is not.
**How to avoid:** Cache at the FIRST call. Use the lazy-singleton pattern from `src/chains/ethereum.ts:13-33`.
**Warning signs:** A test that toggles `VAULTPILOT_DEMO` mid-session and expects the new value to take effect immediately — call `_resetDemoModeForTesting()` between toggles (the test at `test/pair-ledger-live.test.ts:207` deletes the env var fresh each test via beforeEach; this pattern survives unchanged because the cache resets between vitest test files via module re-import).

### Pitfall 2: Demo-mode test isolation regression
**What goes wrong:** Phase 5 adds the config-file branch. A test that just sets `process.env.VAULTPILOT_DEMO = "true"` (which Phase 3+4 tests do — see `test/pair-ledger-live.test.ts:189`) is no longer the only signal — if the user's real `~/.vaultpilot-mcp/config.json` exists AND has `demo: false`, the test now reads the file and the result depends on the developer's home directory.
**Why it happens:** The new resolution chain reads the real filesystem.
**How to avoid:** The resolver short-circuits on `VAULTPILOT_DEMO` set to a recognized literal — config file is read only when env is unset. Phase 3+4 tests always SET the env var first, so they remain isolated. Make this explicit in the resolution-chain docstring. **For tests of the new auto-detect arm specifically** (no env, file missing), use a test-mode override hook: an optional `__overrideConfigPath?: string` parameter on the internal resolver, accepted only in test mode, OR `_resetDemoModeForTesting({ configPath })`.
**Warning signs:** A new test fails locally but passes in CI (or vice versa) because of the developer's home-directory state.

### Pitfall 3: Update check blocks tool dispatch
**What goes wrong:** Update check is awaited inline at boot; slow network blocks the `initialize` handshake.
**Why it happens:** Treating an HTTP GET as a setup step.
**How to avoid:** **Fire-and-forget.** `fetch(...).then(...).catch(() => {})` — never await; never block. The 2s `AbortSignal.timeout` is for cleanup, not for the boot path.
**Warning signs:** First tool call hangs > 200ms on a fresh boot.

### Pitfall 4: NOTICE block races the first tool response
**What goes wrong:** Two concurrent tool calls arrive (legitimate — agents pipeline). Both check `firstResponseEmitted`; both see `false`; both prepend NOTICE.
**Why it happens:** Module-scoped `let` is single-threaded in Node, but the `setRequestHandler` callbacks are async; between the check and the assignment, another callback may run.
**How to avoid:** Set `firstResponseEmitted = true` BEFORE awaiting any work — at the top of the dispatcher's wrap. The "first wins" semantics are correct because both responses go to the same agent process, but only one needs the NOTICE.
**Warning signs:** Two NOTICE blocks in a session (test for this — assert exactly one across N back-to-back tool calls).

### Pitfall 5: `send_transaction` demo `from` address comes from `null` `getStatus()`
**What goes wrong:** Currently `src/tools/send_transaction.ts:318-358` runs `viem.call({ to, value, data })` without `from` / `account`. In demo mode, `getStatus()` returns null (no WC pair), so any `from` field MUST come from the active persona.
**Why it happens:** Phase 4 shipped the envelope with the call sketch's `from` left to be wired in Phase 5.
**How to avoid:** Plan 05-02 adds `account: getActivePersona().address` to the `call(...)` call. **Note: viem's `call` action uses `account`, NOT `from`** (verified at https://viem.sh/docs/actions/public/call — `account: Account | Address`).
**Warning signs:** The simulation result is computationally meaningless because msg.sender defaults to `0x0`; reverts that depend on the caller will misreport. Trust-pipeline integration test at `test/trust-pipeline.integration.test.ts:129` doesn't exercise this (skips demo); Phase 5's demo-flow integration test (recommended new test) does.

### Pitfall 6: Strict-literal predicate erosion under new resolution chain
**What goes wrong:** A future contributor relaxes the `VAULTPILOT_DEMO=true` check to `.toLowerCase() === "true"`. The test at `test/pair-ledger-live.test.ts:207-226` (`'True'` capitalized does NOT trigger refusal) breaks.
**Why it happens:** "Helpfulness" instinct.
**How to avoid:** The literal-`"true"` arm of the new resolution chain stays byte-identical. Plan 05-01's plan-text MUST re-state the DEMO-01 strict-literal contract. The existing test is a regression anchor and MUST keep passing.

### Pitfall 7: `set_demo_wallet` mutates persona state from a non-demo session
**What goes wrong:** Agent calls `set_demo_wallet({ persona: "whale" })` in production-mode (paired Ledger). Server obeys silently; downstream calls don't change behavior because non-demo paths don't read `activePersona`. Confusing from the agent's POV.
**How to avoid:** Refuse with a structured error envelope (`WRONG_MODE` or similar — see § Q-WRONG-MODE) when `!isDemoMode()`. State is NOT mutated.

## Code Examples

### Plan 05-01: Demo-mode resolution chain
```typescript
// Source: derived from src/chains/ethereum.ts pattern + src/diagnostics/check.ts:96-124
// File: src/config/demo-resolve.ts (new)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { log } from "../diagnostics/logger.js";

export function getConfigPath(): string {
  return join(homedir(), ".vaultpilot-mcp", "config.json");
}

interface ConfigFile {
  demo?: boolean;
  // Other fields ignored at this layer
}

type ResolutionResult =
  | { mode: "env-on" }
  | { mode: "env-off" }
  | { mode: "config-on" }
  | { mode: "config-off" }
  | { mode: "auto-demo" }
  | { mode: "config-no-demo-key" }; // config exists but has no `demo` key → boot real-mode

let cached: ResolutionResult | undefined;

export function resolveDemoMode(): ResolutionResult {
  if (cached) return cached;

  const envRaw = process.env.VAULTPILOT_DEMO;

  // ENV arm: literal-string match per DEMO-01/02; any other value rejects
  if (envRaw !== undefined) {
    if (envRaw === "true") {
      cached = { mode: "env-on" };
      return cached;
    }
    if (envRaw === "false") {
      cached = { mode: "env-off" };
      return cached;
    }
    // Q-STRICT (open): reject-and-exit, OR fall through to next arm. Default: reject.
    log(
      "error",
      `VAULTPILOT_DEMO must be literal "true" or "false"; got "${envRaw}". Refusing to boot.`,
    );
    process.exit(1);
  }

  // CONFIG arm
  const path = getConfigPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // File missing — auto-demo (DEMO-07 + INST-05)
    cached = { mode: "auto-demo" };
    return cached;
  }

  let parsed: ConfigFile;
  try {
    parsed = JSON.parse(raw) as ConfigFile;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log(
      "error",
      `${path} is malformed: ${reason}. Refusing to boot. Delete or fix the file.`,
    );
    process.exit(1);
  }

  if (parsed.demo === true) {
    cached = { mode: "config-on" };
    return cached;
  }
  if (parsed.demo === false) {
    cached = { mode: "config-off" };
    return cached;
  }
  // File exists, no `demo` key → user has configured the server, just hasn't opted in.
  cached = { mode: "config-no-demo-key" };
  return cached;
}

export function isDemoMode(): boolean {
  const r = resolveDemoMode();
  return r.mode === "env-on" || r.mode === "config-on" || r.mode === "auto-demo";
}

/** True iff demo mode was selected by the no-config + no-env auto-detect arm.
 *  Plan 05-03 reads this to decide whether to emit the AUTO_DEMO NOTICE block. */
export function isAutoDemo(): boolean {
  return resolveDemoMode().mode === "auto-demo";
}

export function _resetDemoModeForTesting(): void {
  cached = undefined;
}
```

`src/config/env.ts::isDemoMode()` body shrinks to:
```typescript
// File: src/config/env.ts (evolved)
import { isDemoMode as isDemoModeResolved } from "./demo-resolve.js";

export function isDemoMode(): boolean {
  return isDemoModeResolved();
}
```

**Type-checked:** All Node.js built-in modules verified at `process.version v22.19.0`. Signature `process.exit(code?: number): never` (lib.dom.d.ts).

### Plan 05-01: Persona registry
```typescript
// File: src/demo/personas.ts (new)
// Address picks justified inline — researcher-vetted, executor confirms at write time.

import { type Address, getAddress } from "viem";

export interface Persona {
  readonly name: "whale" | "defi-degen" | "stable-saver" | "staking-maxi";
  readonly address: Address;
  readonly description: string;
  readonly rehearsableFlows: ReadonlyArray<string>;
}

export const PERSONAS: ReadonlyArray<Persona> = [
  {
    name: "whale",
    // vitalik.eth — canonical, multi-chain, well-known.
    // Source: https://etherscan.io/address/vitalik.eth (verified 2026-05-12)
    address: getAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    description:
      "Large native ETH balance with mixed historical positions. Exercises get_portfolio_summary's native + ERC-20 + USD-total path against a heterogeneous wallet.",
    rehearsableFlows: [
      "get_portfolio_summary",
      "get_token_balance",
      "resolve_ens_name",
      "reverse_resolve_ens",
      "get_transaction_status",
    ],
  },
  // defi-degen, stable-saver, staking-maxi — executor selects from researched candidates:
  //   defi-degen:    a known active Uniswap V3 LP wallet (NOT a router/factory contract)
  //   stable-saver:  Circle treasury 0x55FE002aefF02F77364de339a1292923A15844B8 (USDC-heavy, stable)
  //                  https://etherscan.io/address/0x55fe002aeff02f77364de339a1292923a15844b8
  //   staking-maxi:  a stETH-heavy EOA (NOT the Lido stETH contract 0xae7ab9...)
  //                  candidates surface on https://etherscan.io/token/0xae7ab96520de3a18e5e111b5eaab095312d7fe84#balances
  // The executor confirms each address (1) is an EOA, not a contract, (2) has stable composition over time,
  // (3) does NOT belong to a sanctioned / OFAC-listed actor (low risk but worth checking).
];

let activePersona: Persona | null = null;

export function getActivePersona(): Persona | null {
  return activePersona;
}

export function setActivePersona(name: Persona["name"]): Persona {
  const found = PERSONAS.find((p) => p.name === name);
  if (!found) {
    throw new Error(`unknown persona: ${name}`);
  }
  activePersona = found;
  return found;
}

export function _resetActivePersonaForTesting(): void {
  activePersona = null;
}
```

### Plan 05-02: `send_transaction` demo `from` wiring (one-line edit)
```typescript
// Source: src/tools/send_transaction.ts:318-358 (existing) — EVOLVE to:

if (isDemoMode()) {
  const client = getEthereumClient();
  const persona = getActivePersona(); // NEW import from "../demo/personas.js"
  let simulationResult: Hex | null = null;
  let simulationError: string | null = null;
  try {
    const callResult = await call(client, {
      account: persona?.address,            // NEW — persona address as msg.sender
      to: record.tx.to,
      value: record.tx.valueWei,
      data: record.tx.data,
    });
    simulationResult = callResult.data ?? ("0x" as Hex);
  } catch (err) {
    simulationError = err instanceof Error ? err.message : String(err);
  }
  // ... rest unchanged ...
}
```

Note: `account: persona?.address` is `Address | undefined`. viem accepts `undefined` (falls back to no-from-set behavior); the type signature `account?: Account | Address` is verified at https://viem.sh/docs/actions/public/call.

Phase 4 Test 9 (`test/send-transaction.test.ts:531-564`) seeds `seedPreviewedHandle()` directly via the handle-store API; Plan 05-02 EXTENDS this test by setting an active persona via `setActivePersona("whale")` in `beforeEach` and asserting the simulation `account` field reached `viem.call(...)` (via `callSpy.mock.calls[0][1]`).

### Plan 05-03: Update check
```typescript
// File: src/diagnostics/update-check.ts (new)

import { log } from "./logger.js";

const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const TIMEOUT_MS = 2000;

let fired = false;

export function runUpdateCheckOnce(currentVersion: string, packageName: string): void {
  if (fired) return;
  fired = true;
  if (process.env.VAULTPILOT_DISABLE_UPDATE_CHECK === "1") {
    log("info", "update check suppressed (VAULTPILOT_DISABLE_UPDATE_CHECK=1)");
    return;
  }
  // Fire-and-forget; never block.
  doFetch(packageName, currentVersion).catch(() => {
    // Silent on failure — network down should NEVER surface to the user as an error
  });
}

async function doFetch(packageName: string, currentVersion: string): Promise<void> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/latest`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return;
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== "string") return;
  if (body.version === currentVersion) {
    log("info", `vaultpilot-mcp is up to date (v${currentVersion})`);
    return;
  }
  log(
    "warn",
    `vaultpilot-mcp v${currentVersion} → v${body.version} available; run \`npm i -g vaultpilot-mcp\` to update`,
  );
}

export function _resetUpdateCheckForTesting(): void {
  fired = false;
}
```

**Type-checked:** `globalThis.fetch` returns `Promise<Response>` (Node 18.17+ built-in); `AbortSignal.timeout(ms)` returns `AbortSignal` (Node 17.3+ built-in). Confirmed at `node -e "console.log(typeof globalThis.fetch, typeof globalThis.AbortController, process.version)"` → `function function v22.19.0`.

### Plan 05-03: First-response NOTICE intercept (dispatcher wrap)
```typescript
// Source: src/server.ts:76-107 (existing dispatcher) — wrap with:

let firstResponseEmitted = false;

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const handlerResult = await dispatchTool(request); // existing body factored into helper

  // Wave 0 NEW: prepend AUTO_DEMO NOTICE on the very first tool response of the session
  // iff the resolver picked the auto-demo arm. Set the flag BEFORE awaiting (Pitfall 4).
  if (!firstResponseEmitted && isAutoDemo()) {
    firstResponseEmitted = true;
    const noticeBlock = { type: "text" as const, text: AUTO_DEMO_NOTICE_TEMPLATE };
    handlerResult.content = [noticeBlock, ...handlerResult.content];
  } else {
    firstResponseEmitted = true;
  }

  return handlerResult;
});
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 (installed) |
| Config file | none — vitest auto-discovers `test/**/*.test.ts` |
| Quick run command | `npm test -- test/demo-resolve.test.ts` (per-file) |
| Full suite command | `npm test` (full) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEMO-01 | `VAULTPILOT_DEMO=true` literal → demo on | unit | `npm test -- test/demo-resolve.test.ts` | ❌ Wave 0 (new file) |
| DEMO-01 | `VAULTPILOT_DEMO=True` (capital) does NOT trigger demo | regression | EXISTING `test/pair-ledger-live.test.ts:207` (must still pass) | ✅ |
| DEMO-02 | `VAULTPILOT_DEMO=false` → demo off | unit | `npm test -- test/demo-resolve.test.ts` | ❌ Wave 0 |
| DEMO-02 (Q-STRICT) | `VAULTPILOT_DEMO=1` / `yes` → process.exit(1) + stderr | unit | `npm test -- test/demo-resolve.test.ts` (spawn subprocess) | ❌ Wave 0 |
| DEMO-03 | `get_demo_wallet()` lists 4 personas | unit | `npm test -- test/get-demo-wallet.test.ts` | ❌ Wave 0 |
| DEMO-04 | `set_demo_wallet({ persona: "whale" })` activates whale | unit | `npm test -- test/set-demo-wallet.test.ts` | ❌ Wave 0 |
| DEMO-04 | `set_demo_wallet({ persona: "unknown" })` → INVALID_INPUT | unit | `npm test -- test/set-demo-wallet.test.ts` | ❌ Wave 0 |
| DEMO-04 | `set_demo_wallet` outside demo mode → WRONG_MODE (Q-WRONG-MODE) | unit | `npm test -- test/set-demo-wallet.test.ts` | ❌ Wave 0 |
| DEMO-05 | Demo `send_transaction` uses persona address as `account` | unit | `npm test -- test/send-transaction.test.ts` (EVOLVE test 9) | ✅ (evolve) |
| DEMO-05 | End-to-end: set_demo_wallet → get_portfolio_summary → simulation | integration | `npm test -- test/demo-flow.integration.test.ts` | ❌ Wave 0 |
| DEMO-06 | Demo `pair_ledger_live` refuses | regression | EXISTING `test/pair-ledger-live.test.ts:188` (must still pass) | ✅ |
| DEMO-06 | Demo `prepare_native_send` refuses | regression | EXISTING `test/prepare-native-send.test.ts:108` (must still pass) | ✅ |
| DEMO-06 | Demo `preview_send` refuses | regression | EXISTING `test/preview-send.test.ts:555` (must still pass) | ✅ |
| DEMO-06 | Demo `get_tx_verification` refuses | regression | EXISTING `test/get-tx-verification.test.ts:282` (must still pass) | ✅ |
| DEMO-07 | Auto-demo (no env, no config) → demo on | unit | `npm test -- test/demo-resolve.test.ts` (with `__overrideConfigPath` to /nonexistent) | ❌ Wave 0 |
| DEMO-07 | First tool response carries `VAULTPILOT NOTICE — Auto demo mode active` | integration | `npm test -- test/server-bootstrap.test.ts` (EVOLVE) OR new `test/auto-demo-notice.test.ts` | partial (evolve) |
| DEMO-07 | NOTICE fires exactly ONCE per session | integration | `npm test -- test/auto-demo-notice.test.ts` | ❌ Wave 0 |
| DIAG-01 | `get_vaultpilot_config_status` returns exact field set | unit | `npm test -- test/get-vaultpilot-config-status.test.ts` | ❌ Wave 0 |
| DIAG-01 | Response NEVER contains the `ETHEREUM_RPC_URL` value, only the boolean | regression | same file — assert by string search on `JSON.stringify(result)` | ❌ Wave 0 |
| DIAG-02 | `get_ledger_device_info` returns `{ paired: false, ... }` envelope when unpaired | unit | `npm test -- test/get-ledger-device-info.test.ts` | ❌ Wave 0 |
| DIAG-03 | `Server` constructor `instructions` field carries text | regression | EXISTING `test/server-bootstrap.test.ts` (verify post-edit text shape) | ✅ (verify) |
| DIAG-04 | Update check fires once per session | unit | `npm test -- test/update-check.test.ts` | ❌ Wave 0 |
| DIAG-04 | `VAULTPILOT_DISABLE_UPDATE_CHECK=1` suppresses | unit | `npm test -- test/update-check.test.ts` | ❌ Wave 0 |
| DIAG-04 | Fetch failure is silent (no error logged) | unit | `npm test -- test/update-check.test.ts` | ❌ Wave 0 |
| INST-05 | First-run flow end-to-end | integration | `npm test -- test/demo-flow.integration.test.ts` | ❌ Wave 0 |
| Backwards-compat | All 196 Phase 1-4 tests pass after Plan 05-01 lands | regression | `npm test` (full) | ✅ (verify) |

### Sampling Rate
- **Per task commit:** `npm test -- <changed-file.test.ts>` (per-file, ~5s)
- **Per wave merge:** `npm test` (full suite, all 196 + new tests; < 15s budget)
- **Phase gate:** Full suite + `npm run typecheck` + `npm run build` all green before `/gsd-verify-work`

### Wave 0 Gaps

Test files to create:
- [ ] `test/demo-resolve.test.ts` — covers resolution chain (env / config / auto-detect / rejection)
- [ ] `test/get-demo-wallet.test.ts` — registers + lists personas
- [ ] `test/set-demo-wallet.test.ts` — activate / unknown / wrong-mode
- [ ] `test/get-vaultpilot-config-status.test.ts` — DIAG-01 envelope + secret-safety
- [ ] `test/get-ledger-device-info.test.ts` — DIAG-02 envelope shape (paired + unpaired)
- [ ] `test/update-check.test.ts` — DIAG-04 fire-once / suppress / silent-fail (mock global `fetch`)
- [ ] `test/auto-demo-notice.test.ts` — DEMO-07 first-response intercept (mock dispatcher OR use `buildServer()` + injected handler)
- [ ] `test/demo-flow.integration.test.ts` — Plan 05-02 end-to-end demo flow (mirrors `test/trust-pipeline.integration.test.ts:175` shape)

Test files to evolve:
- [ ] `test/send-transaction.test.ts:531-564` (Test 9) — assert persona address reaches `call(...)` `account` field via `setActivePersona("whale")` in beforeEach + `callSpy.mock.calls[0][1].account` assertion
- [ ] `test/server-bootstrap.test.ts` — assert `instructions` field text post-rewrite (if 05-03 rewrites it)

Test helpers (Wave 0):
- [ ] `test/helpers/mock-config-file.ts` — `mkdtemp` + write `config.json` + return path; cleanup in afterAll. Used by `test/demo-resolve.test.ts` and `test/demo-flow.integration.test.ts`. NEVER touches `~/.vaultpilot-mcp/`. Probable shape: `mockConfigFile({ demo: true }) => { path: string; cleanup: () => void }`.
- [ ] `test/helpers/mock-fetch.ts` (optional, OR inline `vi.spyOn(globalThis, "fetch")`) — for the update-check fetch mock.

Framework install: **none** — vitest already installed. No `vitest.config.ts` is in-tree; the default discovery covers `test/**/*.test.ts` (verified at `test/` listing — 21 test files all detected by `npm test`).

## Security Domain

### Applicable ASVS Categories (Level 2 per `.planning/config.json:security_asvs_level`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — local stdio only, no users/sessions |
| V3 Session Management | partial | WC session topic ALREADY surfaced as last-8-chars by `get_ledger_status` (Phase 3); DIAG-01 surfaces last-8 only (NEVER full topic) |
| V4 Access Control | partial | `set_demo_wallet` requires demo mode (WRONG_MODE refusal); `pair_ledger_live` requires non-demo (DEMO_MODE_REFUSED refusal). Both already-shipped patterns |
| V5 Input Validation | yes | New tools' `inputSchema` validated by Phase 4's `AjvJsonSchemaValidator` at `src/server.ts:55-66`. Persona names enforce enum `["whale", "defi-degen", "stable-saver", "staking-maxi"]` at schema layer |
| V6 Cryptography | no | No new crypto — DIAG tools surface state; update check uses HTTPS via fetch (TLS cert validation by Node default) |
| V7 Error Handling | yes | Update-check failures silently swallowed (per DIAG-04); structured-error envelopes for tool refusals via existing `makeStructuredError` from `src/signing/error-codes.ts` |
| V8 Data Protection | yes | DIAG-01 explicitly returns booleans/counts; **the secret-safety assertion is the load-bearing test** (see § Validation Architecture row 26) |
| V14 Configuration | yes | Config file path consistent across the codebase (NEW: extracted via `getConfigPath()`); malformed config refuses to boot with named-file error |

### Known Threat Patterns for {stdio MCP server + npm-registry HTTP + filesystem config read}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised agent calls `set_demo_wallet` in production mode to inject fake state | Tampering (mode confusion) | `WRONG_MODE` refusal: persona state mutation requires `isDemoMode() === true` |
| Compromised host writes malicious `~/.vaultpilot-mcp/config.json` (e.g. `{ "demo": false }` to trick a demo-expecting user into real signing) | Tampering | Out-of-scope — host-FS compromise is in the threat model (`PROJECT.md:56`); defense is the Ledger device, not the MCP. `prepare_*` flows still hit the same `pair_ledger_live` precondition |
| MCP exfiltrates env var values via DIAG-01 | Information Disclosure | The DIAG-01 contract returns ONLY booleans / counts / last-8-suffix. The regression test asserts no `process.env.ETHEREUM_RPC_URL` substring appears in `JSON.stringify(result)` |
| Update check leaks the current install version to a hostile network | Information Disclosure | Acceptable per OSS norm; suppressible via `VAULTPILOT_DISABLE_UPDATE_CHECK=1`. No other PII transmitted. (Network egress is implicit when using public RPC + DefiLlama already) |
| Update check fetches arbitrary URL based on tampered `package.json` (e.g. `"name": "evil-pkg"`) | Tampering | The URL is templated from the package name; an attacker who can write `package.json` can already do worse (modify any source). Out of scope |
| MCP claims demo mode in DIAG-01 while actually being in production mode | Tampering (mode lie) | DIAG-01 reads from the SAME `isDemoMode()` predicate the refusal paths read from. A mismatched value would fail equality with the refusal-path behavior. The test asserts coherence: a session that gets a refusal MUST report `demoMode: true` |
| `set_demo_wallet({ persona: "<huge string>" })` DOS via schema-level reflection | Denial of Service | `inputSchema.properties.persona.enum: ["whale", ...]` — schema rejects at the SDK boundary BEFORE the handler runs (Phase 4's `AjvJsonSchemaValidator` gate). Defense in depth: handler re-checks `PERSONAS.find(...)` |
| Race on `firstResponseEmitted` flag duplicates NOTICE | Tampering (in-process) | Set flag BEFORE awaiting any work in the dispatcher wrap (Pitfall 4 above) |

### Residual Risk
- **Auto-demo NOTICE is host-trusted text.** A compromised MCP can omit the NOTICE; the agent has no out-of-band reference to compare against. Companion skill (v1.3) is the load-bearing defense; documented in `docs/adr/0003-defer-companion-skill-to-v1-3.md`.
- **`set_demo_wallet` mode confusion** in a multi-agent context: a host runs the server in non-demo mode but the agent thinks it's demo mode and calls `set_demo_wallet` for "preview". WRONG_MODE refusal surfaces this to the agent; the user is not exposed to surprise signing because the signing path is independently demo-gated. Acceptable.

## Assumptions Log

> Every claim tagged `[ASSUMED]` in this research is listed here. The planner + discuss-phase use this section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `VAULTPILOT_DEMO` set to ANY non-`"true"`/`"false"` value should **refuse to boot** (exit 1 + stderr) rather than fall through to the config-file arm | § Plan 05-01 example + § Q-STRICT | LOW — alternative is fall-through to config; surface in discuss-phase. Either choice is defensible. Strict refusal aligns with DEMO-01/02 "deterministic" phrasing |
| A2 | `~/.vaultpilot-mcp/config.json` with no `demo` key → boot real-mode (user has configured but not opted in to demo) | § Plan 05-01 example | LOW — alternative is "auto-demo if `demo` key absent". Strict-config-real aligns with "the user took the trouble to write a config; respect their choice" |
| A3 | The auto-demo NOTICE block fires ONLY when the resolver picked the auto-detect arm — NOT when env/config explicitly opt-in to demo | § Plan 05-03 + Pattern 2 | LOW — alternative is "fire NOTICE whenever in demo mode". Auto-only matches DEMO-07's wording ("brand-new install") and the intent (first-contact education, not session-by-session reminder) |
| A4 | Persona addresses (whale = vitalik.eth; stable-saver = Circle treasury; staking-maxi = stETH-heavy EOA; defi-degen = active Uniswap V3 LP) are stable over time (no rug, no sanctioning) | § Plan 05-01 example | MEDIUM — executor MUST confirm each address (1) is an EOA not a contract, (2) is not OFAC-sanctioned, (3) has stable composition. Vitalik is canonical-stable; the others need executor validation |
| A5 | Update-check package name in `package.json` is the npm-published name (and the project owns it on npm) | § Q-NPM below | HIGH — `npm view vaultpilot-mcp version` returns `0.14.4` (the UPSTREAM project, not this rebuild). Either (a) rename `package.json` to a non-colliding name OR (b) skip update-check until a real package name is locked. See § Open Questions |
| A6 | `get_ledger_device_info` returns inferred state (paired + last-8 + chain support) — NOT a true device probe — because no WC method exists for app/firmware introspection | § Q-DIAG-02 below | LOW — DIAG-02 requirement text says "probes... reports which app is open + actionable hint". The hint compensates for the inability to actually probe |
| A7 | DIAG-03's existing `INSTRUCTIONS` text at `src/server.ts:28-32` is acceptable post-Phase-4 (no rewrite required); Plan 05-03 verifies it reads correctly but may revise | § Architectural Map | LOW — the text is pre-Phase-4 (mentions "prepare tools"); post-Phase-4 it should mention `payloadFingerprint` / `LEDGER BLIND-SIGN HASH` / `previewToken`. Revision recommended but optional |
| A8 | `set_demo_wallet` outside demo mode refuses with a `WRONG_MODE` errorCode (or equivalent) — does NOT silently mutate persona state | § Pitfall 7 + Q-WRONG-MODE | LOW — alternative is to mutate state silently. Refusing is the safer default + matches the "every refusal surfaces a structured error" convention |

**If this table is empty:** N/A — 8 assumptions surfaced. Risk grading: A5 (HIGH), A4 (MEDIUM), rest (LOW). A5 is the only one that can block execution; the others are design choices the planner / discuss-phase locks.

## Open Questions

1. **Q-NPM: What is the real npm package name for this project?**
   - What we know: `package.json:2` says `"name": "vaultpilot-mcp"`. `npm view vaultpilot-mcp version` → `0.14.4` (the UPSTREAM project at `0.14.4`, not this rebuild at `0.0.0`).
   - What's unclear: Either the rebuild gets a different name (e.g. `vaultpilot-mcp-gsd`, `@szhygulin/vaultpilot-mcp`), OR the update check is skipped until a real package name is locked, OR Phase 10 (DIST-40) ships the binary under a different distribution channel and `npm` isn't even the right registry.
   - Recommendation: Plan 05-03 implements `runUpdateCheckOnce(currentVersion, packageName)` with packageName as a parameter; reads from `package.json::name`; gracefully handles a 404 (or upstream-mismatch-by-version) as "no update check possible — silently noop". Surface the package-name decision to discuss-phase.

2. **Q-STRICT: `VAULTPILOT_DEMO` set to an invalid value — refuse-to-boot or fall through?**
   - What we know: DEMO-01 says literal `"true"` only; DEMO-02 says literal `"false"` is deterministic. Neither explicitly says what happens for `"1"` / `"yes"` / `"True"`.
   - What's unclear: Refuse-to-boot is STRICTER (defends against silent-misconfig); fall-through (treat as unset) is LOOSER (more forgiving).
   - Recommendation: REFUSE TO BOOT with named-error stderr + exit 1. Aligns with "deterministic" phrasing in DEMO-02. The strictness is one-time-at-install pain for a permanent class of misconfig bugs eliminated. Surface in discuss-phase.

3. **Q-DIAG-02: Can `get_ledger_device_info` actually probe the Ledger?**
   - What we know: No WalletConnect Sign-namespace JSON-RPC method exposes Ledger device state (sources: https://specs.walletconnect.com/2.0/specs/clients/sign/rpc-methods; https://github.com/LedgerHQ/wallet-connect-live-app). Ledger's `wallet-api` exposes `account.list`, `transaction.signAndBroadcast` etc — none of which surface app-open / firmware.
   - What's unclear: Whether the requirement text "probes... reports which app is open + actionable hint" is achievable as-written.
   - Recommendation: `get_ledger_device_info` returns a **structured inferred-state envelope** built entirely from what `getStatus()` + `getActiveSessionTopic()` already expose:
     ```typescript
     {
       paired: boolean,                  // from getStatus() !== null
       address: string | null,           // from getStatus().address (only EIP-55)
       chainId: number | null,           // from getStatus().chainId
       sessionTopicLast8: string | null, // from getStatus().sessionTopicLast8
       appOpen: "Ethereum (inferred from CAIP-2 namespace)" | null,
       firmware: null,                   // never available via WC
       hint: "If get_portfolio_summary fails, ensure the Ethereum app is open in Ledger Live → My Ledger → Manage. If pairing dropped, call pair_ledger_live."
     }
     ```
     This is honest about what we can and can't see. The "probe" verb in the requirement text is interpreted as "surface what we know"; surface the limitation in the tool description routing prompt ("returns inferred state, not a true device probe — Ledger doesn't expose this over WC").

4. **Q-WRONG-MODE: What is the structured errorCode for `set_demo_wallet` called outside demo mode?**
   - What we know: The 13-code `ErrorCode` union in `src/signing/error-codes.ts:28-41` doesn't have a `WRONG_MODE` code. The closest analogues are `WRONG_STATUS` (state-machine concern) and `INVALID_INPUT` (input shape concern). Neither fits.
   - What's unclear: Should Phase 5 expand the ErrorCode union by one slot, OR reuse `INVALID_INPUT`?
   - Recommendation: **Expand by one slot** — `WRONG_MODE` is its own concept (mode lifecycle, not input shape). The expansion is a type-level breaking change downstream (every exhaustive switch on `ErrorCode` must add the case), which is exactly the anti-foot-gun the comment at `error-codes.ts:4-6` describes. Plan 05-01 owns the union expansion.

5. **Q-AUTO-DEMO-PERSONA-DEFAULT: Does auto-demo start with a default active persona, or null?**
   - What we know: `getActivePersona()` returns `Persona | null`. Auto-demo means "no env, no config" — the user hasn't picked a persona.
   - What's unclear: Should auto-demo seed `activePersona = PERSONAS[0]` ("whale") so read tools work out of the box? Or require `set_demo_wallet` first?
   - Recommendation: Auto-demo seeds `whale` as the default at boot (when `isAutoDemo() === true`). Rationale: the user has not yet learned about `set_demo_wallet`; without a default they hit a "no persona active" error on the first read call. Seeding whale (the most general persona) makes the first call work. The NOTICE block names the seeded persona and tells the user how to change it.

6. **Q-CONTRADICTION-PREP: Should `prepare_native_send` simulate in demo mode (allow rehearsing prepare→preview→send) or stay refused?**
   - What we know: In-tree comments at `src/tools/prepare_native_send.ts:123` and `src/tools/preview_send.ts:119` say "Phase 5 lifts this for `send_transaction` to a simulation envelope; `prepare_native_send` remains refused." This is the AUTHORITATIVE in-tree interpretation.
   - What's unclear: The user's research note implies they're considering overturning this. The argument for overturning: under the current design, the demo `send_transaction` simulation envelope is unreachable in practice because the user can't get a handle to pass to it (prepare refuses). Phase 4 Test 9 (`test/send-transaction.test.ts:531-564`) seeds the handle directly via the `handle-store` API — bypassing the refused `prepare_native_send` call. That's a test-only path; a real agent has no such bypass.
   - Recommendation: **Surface this contradiction to the user in discuss-phase.** Two options:
     - **Option A (preserve current design):** `prepare_native_send` + `preview_send` refuse in demo; `send_transaction` simulates. The demo `send_transaction` envelope is documentation/contract, not user-reachable. Pro: zero code change to Phase 3+4; minimal touch surface. Con: the simulation envelope is dead code in practice.
     - **Option B (overturn current design):** `prepare_native_send` + `preview_send` BOTH succeed in demo, using the persona address as the implicit `from` instead of `getStatus().address`. The full prepare → preview → send chain works against a persona. Pro: agents can rehearse the full signing flow without a real Ledger. Con: requires editing Phase 4 code; reshapes the test surface; the demo "user" is interacting with a fake-from address (the persona didn't actually sign — they can't, the user doesn't have their key).
   - Researcher's lean: **Option A** (preserve). The point of demo mode is to rehearse READ flows + show what signing WOULD look like. Rehearsing the prepare→preview chain teaches an agent a workflow that they can't complete against the same persona in production (because the persona's key isn't theirs). Option B is "interactive tutorial"; Option A is "feature gate". A is the lower-risk default for v1.0; the upgrade path to B in a later phase costs one feature-flag.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥ 18.17 (for `globalThis.fetch` + `AbortSignal.timeout`) | DIAG-04 update check | ✓ | v22.19.0 (confirmed at host) | none — `package.json:26` mandates this |
| Public internet access (registry.npmjs.org) | DIAG-04 update check | runtime check | — | Update check silently fails on timeout / DNS failure — no fallback needed |
| `~/` (homedir) readable | All config-file paths | ✓ | — | None — universal on macOS/Linux/Windows |
| Real Ledger device | DIAG-02 truthful probe | N/A in demo mode | — | DIAG-02 returns inferred state from WC session (Q-DIAG-02) |

**Missing dependencies with no fallback:** none — Phase 5 ships entirely on in-tree dependencies + Node built-ins.

## Plan Dependency Graph

```
                ┌──────────── Plan 05-01 ────────────┐
                │ - src/config/demo-resolve.ts       │
                │ - src/config/env.ts (evolved body) │
                │ - src/demo/personas.ts             │
                │ - src/tools/get_demo_wallet.ts     │
                │ - src/tools/set_demo_wallet.ts     │
                │ - src/signing/error-codes.ts       │
                │   (+1 code: WRONG_MODE)            │
                │ - src/tools/register-all.ts (+2)   │
                │ - tests:                           │
                │     test/demo-resolve.test.ts      │
                │     test/get-demo-wallet.test.ts   │
                │     test/set-demo-wallet.test.ts   │
                │     test/helpers/mock-config-file  │
                └──────────────┬─────────────────────┘
                               │ depends on:
                               │  - getActivePersona() function exists
                               │  - isAutoDemo() function exists
                               ▼
                ┌──────────── Plan 05-02 ────────────┐
                │ - src/tools/send_transaction.ts    │
                │   (1-line: pass `account` to call) │
                │ - tests:                           │
                │     test/send-transaction.test.ts  │
                │       (evolve Test 9)              │
                │     test/demo-flow.integration.    │
                │       test.ts (new)                │
                └──────────────┬─────────────────────┘
                               │ depends on:
                               │  - 05-02 doesn't reshape simulation
                               │    envelope (so DIAG-01 surfacing
                               │    of demo state stays stable)
                               ▼
                ┌──────────── Plan 05-03 ────────────┐
                │ - src/tools/get_vaultpilot_        │
                │     config_status.ts               │
                │ - src/tools/get_ledger_device_     │
                │     info.ts                        │
                │ - src/diagnostics/update-check.ts  │
                │ - src/diagnostics/notice.ts        │
                │ - src/server.ts                    │
                │   (wrap dispatcher for NOTICE +    │
                │    optional INSTRUCTIONS rewrite)  │
                │ - src/index.ts                     │
                │   (fire update check at boot)      │
                │ - src/tools/register-all.ts (+2)   │
                │ - tests:                           │
                │     test/get-vaultpilot-config-    │
                │       status.test.ts               │
                │     test/get-ledger-device-info.   │
                │       test.ts                      │
                │     test/update-check.test.ts      │
                │     test/auto-demo-notice.test.ts  │
                └────────────────────────────────────┘
```

**Strictly sequential.** Parallelism between 05-01 and 05-02 fails because 05-02 imports `getActivePersona` from 05-01; parallelism between 05-02 and 05-03 fails because 05-03's `get_vaultpilot_config_status` reads the resolved-mode boolean from 05-01 AND wraps the dispatcher (which 05-02's integration test exercises end-to-end). Sequential merge order: 05-01 → 05-02 → 05-03.

Plan 05-01 carries the most surface (8 files); 05-02 is the smallest (essentially a one-line code change + test evolution); 05-03 is the second-largest (5 files + dispatcher wrap). The phase total is ~14-16 files touched. Comparable to Phase 4's 04-01 plan, larger than the Phase 4 average.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom `~/` path expansion | `node:os::homedir() + path::join` | Node 12+ (homedir has been around forever) | Standard; matches in-tree `src/diagnostics/check.ts:97` |
| `node-fetch` for HTTP | `globalThis.fetch` (Node 18+ built-in) | Node 18 (stable in 18.17) | One fewer dep |
| Custom signal-based timeout via `setTimeout` + `AbortController` | `AbortSignal.timeout(ms)` | Node 17.3+ (stable in 18 LTS) | One-liner replaces 4 lines |
| Per-tool gate on first response | Dispatcher wrap on `CallToolRequest` | Phase 4 set precedent at `src/server.ts:55-66` | DRY; one place to maintain |

**Deprecated/outdated:** None in scope. Phase 5 has no legacy migration.

## Sources

### Primary (HIGH confidence — verified by inspection of installed files OR running Node)
- `src/config/env.ts:36-38` (current `isDemoMode()` body)
- `src/server.ts:28-32, 42` (existing `instructions` field)
- `src/server.ts:55-66, 76-107` (`AjvJsonSchemaValidator` gate + dispatcher)
- `src/diagnostics/check.ts:96-124` (canonical `~/.vaultpilot-mcp/config.json` path + read pattern)
- `src/tools/pair_ledger_live.ts:84-99` (DEMO-06 already-shipped)
- `src/tools/prepare_native_send.ts:108-131` (DEMO-mode refusal already-shipped)
- `src/tools/preview_send.ts:111-127` (preview demo refusal already-shipped)
- `src/tools/send_transaction.ts:318-358` (DEMO-05 simulation envelope already-shipped)
- `src/tools/get_tx_verification.ts:75-88` (get-tx demo refusal already-shipped)
- `src/signing/error-codes.ts:28-41` (13-code ErrorCode union)
- `src/chains/ethereum.ts:9-44` (lazy-singleton pattern with `_resetForTesting`)
- `test/pair-ledger-live.test.ts:39-69, 187-227` (env-var test pattern + strict-literal regression anchor)
- `test/send-transaction.test.ts:530-564` (DEMO-05 simulation test seeding handle directly)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:11-15` (`instructions?: string` on ServerOptions)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:881-884, 7411-7414` (Zod schema for `instructions`)
- Local Node runtime: `node -e "console.log(typeof globalThis.fetch, typeof globalThis.AbortController, process.version)"` → `function function v22.19.0`
- `package.json:30-35` (no new deps needed; all libs in place)

### Secondary (MEDIUM confidence — verified across multiple sources OR official docs)
- npm registry response shape: `GET https://registry.npmjs.org/<pkg>/latest` → JSON `{ version: string, ... }` — verified via two `WebFetch` calls (vaultpilot-mcp + express)
- viem `call({ account, ... })` parameter — verified at https://viem.sh/docs/actions/public/call (note: uses `account`, NOT `from`)
- vitalik.eth canonical address `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` — multiple etherscan + chain explorer sources
- Circle USDC treasury `0x55FE002aefF02F77364de339a1292923A15844B8` — etherscan + clankapp
- WalletConnect Sign protocol method registry — https://specs.walletconnect.com/2.0/specs/clients/sign/rpc-methods (no device-info method)
- Ledger Live `wallet-connect-live-app` source — https://github.com/LedgerHQ/wallet-connect-live-app (no device-info method)

### Tertiary (LOW confidence — single source / unverified / will be locked at execute time)
- Persona address candidates for `defi-degen` and `staking-maxi` — final picks deferred to executor; researcher named the properties each must exhibit (EOA, stable composition, non-OFAC)
- Exact text of revised `INSTRUCTIONS` field if Plan 05-03 rewrites — researcher recommends but doesn't draft

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep is already in `package.json`; Node version confirmed live
- Architecture: HIGH — all patterns have in-tree precedents (lazy-singleton, side-effect-import, format-fanout sentinel, dispatcher wrap)
- Pitfalls: HIGH — derived from Phase 3 + 4 retros and explicit in-tree comments
- Persona address picks: MEDIUM — vitalik / Circle are canonical; degen / staking-maxi need executor confirmation
- DIAG-02 probe surface: LOW — no WC method exists; recommend inferred-state envelope (documented in Q-DIAG-02)
- npm package name for update check: LOW — collision with upstream; surface in discuss-phase (A5)

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 (30 days — Phase 5 should be planned + executed before this; the only fast-moving variable is persona address stability)

## RESEARCH COMPLETE
