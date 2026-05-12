# Phase 5: Demo mode + diagnostics — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 17 new files + 6 extensions (12 new source + 5 new test, plus extensions to `src/config/env.ts`, `src/signing/error-codes.ts`, `src/tools/register-all.ts`, `src/server.ts`, `src/index.ts`, and to two Phase 4 test files — see § Phase 4 Test Surface Changes)
**Analogs found:** 17 / 23 (six patterns are first-of-their-kind — see § No Analog Found)

## Executive Summary

Phase 5 is an **evolution-not-replacement** phase. Most files mirror patterns Phase 2 / 3 / 4 already cemented:

- **Lazy-singleton with `_resetForTesting()`** — `src/chains/ethereum.ts:9-44` is the in-tree precedent that `src/config/env.ts` (evolved body) and `src/demo/state.ts` adopt verbatim. Both modules cache resolution at first call; both expose a `_reset*ForTesting()` helper for test isolation.
- **Side-effect-import tool registration** — exact mirror of Phase 4 (4 new tools across Plans 05-01 + 05-03; `register-all.ts` gains 4 import lines).
- **`isDemoMode()` short-circuit FIRST in every signing handler** — Phase 5 PRESERVES this for `pair_ledger_live` + `get_tx_verification` (both stay refused in demo) and INVERTS it for `prepare_native_send` + `preview_send` (both now SUCCEED in demo using the persona address — Q-CONTRADICTION-PREP Option B locked decision; Phase 4 test assertions need replacement — see § Phase 4 Test Surface Changes).
- **Structured `errorCode` envelopes** — `src/signing/error-codes.ts` extends the union by one slot (`WRONG_MODE`); every new tool emits `INVALID_INPUT` / `WRONG_MODE` envelopes through the existing `makeStructuredError` constructor.
- **Format-fanout-sentinel string templates** — `AUTO_DEMO_NOTICE_TEMPLATE` mirrors `VERIFY_ON_DEVICE_TEMPLATE` exactly (`src/tools/pair_ledger_live.ts:51-61`); tests import the const, substitute the same way the dispatcher does.
- **Dispatcher wrap at the SDK boundary** — `src/server.ts:76-107` is the Phase 4 precedent (`AjvJsonSchemaValidator` gate). Plan 05-03's first-response NOTICE intercept extends the same dispatcher with a one-shot wrap; right scope = SDK boundary, not per-tool gates.
- **Module-scoped LRU cache + insertion-order eviction** — `src/clients/fourbyte.ts:34-52` is the precedent; the update-check module uses `let fired = false` flag instead because it's once-per-process, not LRU.
- **HTTP fetch + AbortController timeout** — `src/clients/fourbyte.ts:75-90` is the verbatim precedent. The update-check module differs in being **fire-and-forget** — the timeout exists for cleanup, not for back-pressure.

Six patterns are genuinely new in Phase 5 and must be locked here so later phases don't accidentally restyle them. They span: (1) filesystem-config-read at boot (`src/config/demo-resolve.ts` parses `~/.vaultpilot-mcp/config.json` with strict refusal on malformed JSON), (2) module-scoped mutable single-value state with reset (`src/demo/state.ts`'s `activePersona`), (3) inferred-state diagnostic envelope (`get_ledger_device_info` returns structured "best-guess" data without a real device probe), (4) dispatcher-wrap for response middleware (auto-demo NOTICE prepending), (5) fire-and-forget background fetch (update check — no return-to-handler, no awaited cleanup), (6) `WRONG_MODE` errorCode as the FIRST mode-lifecycle refusal in the project's union.

**The load-bearing flag:** under the Q-CONTRADICTION-PREP Option B decision, two Phase 4 tests (`test/prepare-native-send.test.ts:108` + `test/preview-send.test.ts:555`) currently assert `errorCode: "DEMO_MODE_REFUSED"` in demo mode. Plan 05-02 MUST REPLACE these assertions with "demo mode succeeds with persona address as `from`" — without this replacement, the Plan 05-02 implementation lands green-tests that lie about behavior. See § Phase 4 Test Surface Changes.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/config/demo-resolve.ts` | demo-config (resolver + cache + fs-read) | request-response | `src/chains/ethereum.ts:9-44` (lazy-singleton with reset); `src/diagnostics/check.ts:96-124` (config-file read) | partial (composes both) |
| `src/config/env.ts` (MODIFY) | env-accessor (body shrinks; delegates to resolver) | request-response | `src/config/env.ts:36-38` (current body — same signature) | exact (same file) |
| `src/demo/personas.ts` | demo-registry (frozen const array + checksum) | constants | `src/wallet/session-manager.ts:56-61` (typed `LedgerStatus` interface); no in-tree const-array of checksum addresses | partial — type shape only |
| `src/demo/state.ts` | demo-state (module-scoped mutable single-value + reset) | request-response | `src/wallet/session-manager.ts:108-110` (`inFlightApproval` + `cachedSessionTopic` module-scoped lets with reset) | partial — single-value vs multi-field |
| `src/signing/error-codes.ts` (MODIFY) | error-union (extend by 1 code) | constants | `src/signing/error-codes.ts:28-41` (existing 13-code union — extend in place) | exact (same file) |
| `src/tools/get_demo_wallet.ts` | demo-tool (read-only, no-error path) | request-response | `src/tools/get_ledger_status.ts:30-53` (read-only, never errors, structured envelope) | exact |
| `src/tools/set_demo_wallet.ts` | demo-tool (mutates state, mode-gated) | request-response | `src/tools/pair_ledger_live.ts:84-99` (`isDemoMode()`-first refusal pattern, inverted: refuse if NOT demo) | role-match (inverted gate) |
| `src/tools/prepare_native_send.ts` (MODIFY) | signing-tool (demo branch INVERTED) | request-response | self (`src/tools/prepare_native_send.ts:108-131`) — modify the demo branch | exact (same file) |
| `src/tools/preview_send.ts` (MODIFY) | signing-tool (demo branch INVERTED) | request-response | self (`src/tools/preview_send.ts:106-127`) — modify the demo branch | exact (same file) |
| `src/tools/get_vaultpilot_config_status.ts` | diag-tool (read-only state surface) | request-response | `src/tools/get_ledger_status.ts:30-53` (read-only, structured envelope, never errors) | exact |
| `src/tools/get_ledger_device_info.ts` | diag-tool (inferred-state envelope) | request-response | `src/tools/get_ledger_status.ts:30-53` (read-only over session-manager); but the "no real probe" surface has no precedent | partial — see § No Analog Found |
| `src/tools/register-all.ts` (MODIFY +4 lines) | config (import list) | side-effect | `src/tools/register-all.ts:1-12` (existing 11 imports) | exact (same file) |
| `src/diagnostics/update-check.ts` | diag-fetch (fire-and-forget HTTP) | event-driven | `src/clients/fourbyte.ts:69-130` (HTTP fetch + AbortController + result envelope); structurally different (no return, no cache) | partial — see § No Analog Found |
| `src/diagnostics/notice.ts` | diag-template (NOTICE block const) | constants | `src/tools/pair_ledger_live.ts:51-61` (`VERIFY_ON_DEVICE_TEMPLATE`) | exact |
| `src/server.ts` (MODIFY) | dispatcher-wrap (response middleware) | request-response | `src/server.ts:76-107` (existing dispatcher with ajv gate) | exact (same file) |
| `src/index.ts` (MODIFY) | boot-wiring (fire update check) | side-effect | `src/index.ts` (existing entrypoint) | exact (same file) |
| `test/helpers/mock-config-file.ts` | test-helper (mkdtemp + JSON write) | factory | `test/helpers/mock-public-client.ts` (factory shape — `_set*` driver methods + cleanup) | role-match (filesystem vs in-memory) |
| `test/demo-state.test.ts` | test (unit — module-scoped state + reset) | unit | `test/wallet-session-manager.test.ts` (module-state + `_reset*ForTesting()` between tests) | role-match |
| `test/demo-resolution.test.ts` | test (unit — env + fs decision tree) | unit | `test/check-doctor.test.ts` (env-var + filesystem assertions) | exact role |
| `test/get-demo-wallet.test.ts` | test (unit — read-only tool) | unit | `test/get-ledger-status.test.ts` (read-only, no-error path) | exact |
| `test/set-demo-wallet.test.ts` | test (unit — state mutation + mode-gate) | unit | `test/pair-ledger-live.test.ts:187-227` (env-toggle pattern + structured errorCode assertions) | exact role |
| `test/get-vaultpilot-config-status.test.ts` | test (unit — env-controlled state + secret safety) | unit | `test/check-doctor.test.ts` (env-controlled fields) + `test/get-ledger-status.test.ts` (structured-envelope assertions) | exact role |
| `test/get-ledger-device-info.test.ts` | test (unit — paired / unpaired envelope) | unit | `test/get-ledger-status.test.ts` (paired/unpaired structured envelope) | exact |
| `test/update-check.test.ts` | test (unit — global fetch mock + fake timers + once-per-process flag) | unit | `test/pricing-defillama.test.ts` (mocked global fetch); `test/fourbyte.test.ts` (AbortController + fake timers) | exact role |
| `test/notice.test.ts` | test (unit — block-shape + dispatcher integration) | unit | `test/signing-blocks.test.ts` (template-shape sanity) + `test/server-bootstrap.test.ts` (spawn-server + first-response inspection) | role-match |
| `test/demo-flow.integration.test.ts` | test (integration — full demo flow against mocked viem + 4 tool surfaces) | integration | `test/trust-pipeline.integration.test.ts` (full pipeline against 2 mocked SDKs + real handle store) | exact role |

## Pattern Assignments

### `src/config/demo-resolve.ts` (demo-config, request-response)

**Analog (composes two):** `src/chains/ethereum.ts:9-44` (lazy-singleton with reset) + `src/diagnostics/check.ts:96-124` (config-file read with absent/malformed branches).

**Imports pattern** (mirror `src/diagnostics/check.ts:1-3`):

```typescript
// src/diagnostics/check.ts:1-3
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
```

Apply identically (NodeNext ESM; `node:` prefix mandatory on built-ins to match repo convention).

**Lazy-singleton + reset pattern** (`src/chains/ethereum.ts:9-44`):

```typescript
let cachedClient: PublicClient | undefined;
let cachedUsedFallback = false;
let warnedFallback = false;

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

Apply: replace `cachedClient` with `cached: ResolutionResult | undefined`; replace `getEthereumClient` body with the env > config > auto-detect chain from research § Code Example 1 (line 315-372). Cache result at first call; subsequent calls hit the cache. The `_resetDemoModeForTesting()` helper clears the cache for test isolation (matches `_resetEthereumClientForTesting` shape).

**Config-file read pattern** (`src/diagnostics/check.ts:96-124`):

```typescript
function checkConfigFile(): CheckResult {
  const path = join(homedir(), ".vaultpilot-mcp", "config.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { id: "config-file", level: "ok", message: `${path} (absent — auto-demo will run)` };
  }
  try {
    JSON.parse(raw);
    return { id: "config-file", level: "ok", message: `${path} parsed` };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { id: "config-file", level: "warn", message: `${path} malformed: ${reason}` };
  }
}
```

Apply: extract `getConfigPath()` as an EXPORTED helper from `demo-resolve.ts`; **`src/diagnostics/check.ts` imports it** (format-fanout-regex-sync rule — `~/.vaultpilot-mcp/config.json` becomes ONE SOT). Inline check.ts:97 must be replaced with `getConfigPath()` import in the same plan. On malformed JSON in `demo-resolve.ts`, REFUSE TO BOOT via `process.exit(1)` with named-file stderr error (Q-STRICT locked) — diverges from check.ts, which only warns (check.ts is a doctor pass; demo-resolve runs at production boot).

**Stderr error logging** (mirror `src/diagnostics/logger.ts:3-5` usage):

```typescript
import { log } from "../diagnostics/logger.js";
log("error", `VAULTPILOT_DEMO must be literal "true" or "false"; got "${envRaw}". Refusing to boot.`);
process.exit(1);
```

Apply: NEVER `console.error` directly. Always through the logger.

**Done criteria:**
- Exports `resolveDemoMode(): ResolutionResult` (6-arm discriminated union per research § Code Example 1).
- Exports `isDemoMode(): boolean` (derived from resolution result; true on `env-on` / `config-on` / `auto-demo`).
- Exports `isAutoDemo(): boolean` (true ONLY on `auto-demo` arm — Plan 05-03 reads this for NOTICE-emission gate per Q-A3 locked).
- Exports `getConfigPath(): string` (the SOT path computation).
- Exports `_resetDemoModeForTesting(): void` (clears the cache; also accepts an optional `{ configPath?: string }` override per research § Pitfall 2 for test-mode injection — OR the test helper sets `HOME` instead; planner picks).
- Strict-literal `"true"` / `"false"` recognition; ANY other value → `process.exit(1)` (Q-STRICT locked).
- Malformed JSON → `process.exit(1)` with stderr error naming the file path (no fall-through).
- Top-of-file doc comment names the resolution-chain order (env > config > auto-detect) and the Q-STRICT decision.

---

### `src/config/env.ts` (env-accessor, MODIFY — body shrinks)

**Analog (EXACT — same file):** `src/config/env.ts:36-38` (existing `isDemoMode()` body). The signature stays stable; only the body delegates.

**Imports added:**

```typescript
import { isDemoMode as isDemoModeResolved } from "./demo-resolve.js";
```

**Body shrinkage** (replace lines 36-38 verbatim):

```typescript
export function isDemoMode(): boolean {
  return isDemoModeResolved();
}
```

**Why not just re-export?** Re-export changes the call-site shape (`import { isDemoMode } from "../config/demo-resolve.js"` vs the current `"../config/env.js"`); five existing call sites would need import-line edits. Keeping `src/config/env.ts::isDemoMode` as a thin delegate preserves the seam — research § Summary line 9 explicitly names this as the load-bearing invariant.

**Done criteria:**
- The existing doc comment (lines 24-35) is rewritten to reflect Phase 5's evolved body (env > config > auto-detect; references `demo-resolve.ts` as the SOT).
- All Phase 3 + 4 call sites compile unchanged (verified at execute-time by `npm run typecheck`).

---

### `src/demo/personas.ts` (demo-registry, constants)

**Analog (type-shape only):** `src/wallet/session-manager.ts:56-61` (`LedgerStatus` interface).

**Imports pattern** (mirror `src/tools/prepare_native_send.ts:45`):

```typescript
import { type Address, getAddress } from "viem";
```

Apply: `getAddress` checksums the literal addresses AT WRITE TIME so the file's literals are byte-identical to the EIP-55 checksum form. The `Address` template-literal-type narrows the field.

**Frozen-const-array pattern** (no in-tree analog — first frozen registry of typed entries in the codebase; closest shape is `REQUIRED_NAMESPACES` at `src/wallet/session-manager.ts:44-52`, but that's a single-key object, not an array):

```typescript
export interface Persona {
  readonly name: "whale" | "defi-degen" | "stable-saver" | "staking-maxi";
  readonly address: Address;
  readonly description: string;
  readonly rehearsableFlows: ReadonlyArray<string>;
}

export const PERSONAS: ReadonlyArray<Persona> = [
  {
    name: "whale",
    address: getAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    description: "Large native ETH balance with mixed historical positions...",
    rehearsableFlows: [
      "get_portfolio_summary",
      "get_token_balance",
      "resolve_ens_name",
      "reverse_resolve_ens",
      "get_transaction_status",
    ],
  },
  // ... 3 more entries per research § Code Example "Plan 05-01: Persona registry" ...
];
```

**Persona address picks** per research § Code Example (line 416-440):
- `whale` = `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` (vitalik.eth — canonical, executor verifies stability)
- `stable-saver` = `0x55FE002aefF02F77364de339a1292923A15844B8` (Circle USDC treasury — verified 2026-05-12)
- `defi-degen` + `staking-maxi` — researcher named the properties (EOA, stable composition, non-OFAC); **executor confirms specific addresses at write time** per the A4 [ASSUMED] callout in research § Assumptions Log.

**Done criteria:**
- Exports `Persona` interface (4 readonly fields, name as literal union of 4 strings).
- Exports `PERSONAS: ReadonlyArray<Persona>` with exactly 4 entries.
- All addresses passed through `getAddress(...)` at write time (EIP-55 byte-identity asserted by test).
- File has NO module-scoped mutable state — that lives in `src/demo/state.ts` (separation of concerns).

---

### `src/demo/state.ts` (demo-state, request-response)

**Analog (partial):** `src/wallet/session-manager.ts:108-110` — module-scoped `let inFlightApproval` + `let cachedSessionTopic` + `_resetSessionManagerForTesting`. Same shape; different state shape (single optional Persona vs two unrelated fields).

**Imports pattern:**

```typescript
import { PERSONAS, type Persona } from "./personas.js";
```

**Module-scoped state + getter/setter/reset pattern** (`src/wallet/session-manager.ts:108-110, 290-294`):

```typescript
// src/wallet/session-manager.ts:108-110:
let inFlightApproval: Promise<PairResult> | undefined;
let cachedSessionTopic: string | undefined;
let sessionDeleteListenerRegistered = false;

// src/wallet/session-manager.ts:290-294:
export function _resetSessionManagerForTesting(): void {
  inFlightApproval = undefined;
  cachedSessionTopic = undefined;
  sessionDeleteListenerRegistered = false;
}
```

Apply (per research § Code Example, line 442-459):

```typescript
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

**Auto-demo seed behavior** (Q-AUTO-DEMO-PERSONA-DEFAULT locked → "whale" seeded at boot in auto-demo mode):
- The seed itself lives in `src/index.ts` (or `src/server.ts` — planner picks the seam), NOT in this module. Rationale: `state.ts` is pure (no env reads, no booting concerns); the seed-at-boot is a wiring concern.
- Pattern: at boot, `if (isAutoDemo()) { setActivePersona("whale"); }`.

**Done criteria:**
- Exports `getActivePersona(): Persona | null`.
- Exports `setActivePersona(name: Persona["name"]): Persona` — throws on unknown name (defensive; the tool handler catches and surfaces as `INVALID_INPUT`).
- Exports `_resetActivePersonaForTesting(): void`.
- Module has NO direct dependency on `demo-resolve.ts` (no `isDemoMode()` checks) — the tool handlers enforce mode-gating, not this module. Keeps the state module pure / testable in isolation.

---

### `src/signing/error-codes.ts` (error-union, MODIFY +1)

**Analog (EXACT — same file):** `src/signing/error-codes.ts:28-41` (current 13-code union). Extend in place per research § Q-WRONG-MODE locked decision.

**Pattern** (current code):

```typescript
export type ErrorCode =
  | "WALLET_NOT_PAIRED"
  | "HANDLE_NOT_FOUND"
  // ... 11 more codes ...
  | "INTERNAL_ERROR";
```

**Apply:** Add `"WRONG_MODE"` as the 14th member. Order: alphabetical-ish (the existing union isn't strictly alphabetical, but `WRONG_MODE` slots naturally between `WRONG_STATUS` and `PREVIEW_REQUIRED`'s neighborhood — match the existing organization). Update the top-of-file producer map (lines 8-26) to add:

```typescript
//   WRONG_MODE               — Plan 05-01 (set_demo_wallet called outside demo mode)
```

**Why a separate code (not reuse `INVALID_INPUT`)** per research § Q-WRONG-MODE:
- `INVALID_INPUT` is about ARG SHAPE (malformed address, BigInt parse failure). `WRONG_MODE` is about MODE LIFECYCLE (the call is legal but the runtime mode rejects it).
- The 14-code union is a type-level breaking change: every exhaustive `switch` on `ErrorCode` downstream must add the case. This is the anti-foot-gun the comment at lines 4-6 documents.

**Done criteria:**
- Single new code `"WRONG_MODE"` added to the union.
- Producer-map comment updated.
- No test file is broken by the addition (the existing union members all still exhaustive-match).
- `makeStructuredError("WRONG_MODE", "...", cause?)` is the canonical constructor — used by `src/tools/set_demo_wallet.ts`.

---

### `src/tools/get_demo_wallet.ts` (demo-tool, read-only)

**Analog (EXACT):** `src/tools/get_ledger_status.ts:30-53` — read-only, never errors on missing state, returns structured envelope.

**Imports pattern** (mirror `src/tools/get_ledger_status.ts:15-16`):

```typescript
import { PERSONAS } from "../demo/personas.js";
import { getActivePersona } from "../demo/state.js";
import { registerTool } from "./index.js";
```

**Description pattern** (mirror `src/tools/get_ledger_status.ts:18-22`):

```typescript
const DESCRIPTION = [
  "List the curated demo personas (whale, defi-degen, stable-saver, staking-maxi) with their addresses + which read flows are rehearsable, plus the currently-active persona (if any).",
  "Use to discover available personas BEFORE calling set_demo_wallet, or to confirm which persona is active in the current session.",
  "Works in any mode (informational). In non-demo mode the response carries an informational note that signing-flow rehearsal requires demo mode.",
  "Returns `{ personas: [...4 entries...], activePersona: string | null, mode: 'demo' | 'production' }`. Never errors.",
].join(" ");
```

**Input schema pattern** (mirror `src/tools/get_ledger_status.ts:24-28`):

```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};
```

**Handler body** (mirror the no-error read pattern at `src/tools/get_ledger_status.ts:30-53`):

```typescript
registerTool("get_demo_wallet", DESCRIPTION, INPUT_SCHEMA, async () => {
  const active = getActivePersona();
  const personas = PERSONAS.map((p) => ({
    name: p.name,
    address: p.address,
    description: p.description,
    rehearsableFlows: [...p.rehearsableFlows],
  }));
  return {
    content: [{ type: "text", text: /* human-readable list */ }],
    structuredContent: {
      personas,
      activePersona: active?.name ?? null,
      mode: isDemoMode() ? "demo" : "production",
    },
  };
});
```

**Done criteria:**
- Never returns `isError: true` (informational tool).
- Structured envelope carries the FULL `personas` array, not just names.
- DESCRIPTION ≥ 100 chars (per `src/tools/index.ts:28` MIN_DESCRIPTION_LEN warning).
- No `isDemoMode()` first-line short-circuit — the tool works in any mode.

---

### `src/tools/set_demo_wallet.ts` (demo-tool, INVERTED mode-gate)

**Analog (INVERTED gate):** `src/tools/pair_ledger_live.ts:84-99` — the `isDemoMode()`-first refusal pattern, but flipped: this tool refuses if NOT in demo mode (`WRONG_MODE`).

**Imports pattern:**

```typescript
import { isDemoMode } from "../config/env.js";
import { PERSONAS } from "../demo/personas.js";
import { setActivePersona } from "../demo/state.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";
```

**Description pattern** (≥ 100 chars; lock the WRONG_MODE failure mode in the routing prompt):

```typescript
const DESCRIPTION = [
  "Activate a curated demo persona for read-flow rehearsal. The active persona's address becomes the implicit wallet for read tools (get_portfolio_summary, etc.) AND the simulation `from` for prepare/preview/send_transaction in demo mode.",
  "Use ONLY in demo mode (VAULTPILOT_DEMO=true OR auto-demo). Refuses with WRONG_MODE in production mode — call pair_ledger_live to pair a real Ledger instead.",
  "Use BEFORE calling read tools that need a wallet context, and BEFORE prepare_native_send to rehearse signing-flow simulation.",
  "Returns `{ activePersona: { name, address, description, rehearsableFlows } }` on success. Failure modes: WRONG_MODE (not in demo mode), INVALID_INPUT (unknown persona name).",
].join(" ");
```

**Input schema with enum constraint** (matches Phase 4's `enum: ["send", "cancel"]` schema-gate precedent at `src/tools/send_transaction.ts` — see `04-PATTERNS.md` § No Analog Found note 1):

```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    persona: {
      type: "string",
      enum: ["whale", "defi-degen", "stable-saver", "staking-maxi"],
      description: "Persona slug. Must be one of the four canonical entries.",
    },
  },
  required: ["persona"],
  additionalProperties: false,
};
```

The schema-level enum (enforced by Phase 4's ajv gate at `src/server.ts:55-66`) is the FIRST defense; the handler's `PERSONAS.find(...)` check at line N+1 is defense-in-depth (matches Phase 4 prepare_native_send's belt-and-suspenders pattern at line 137 — `pattern` AND `isAddress`).

**Handler body — INVERTED gate + structured errors** (mirror `src/tools/pair_ledger_live.ts:84-99` shape, inverted):

```typescript
registerTool("set_demo_wallet", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // INVERTED gate (Q-WRONG-MODE locked): refuse if NOT in demo mode.
  // Mirrors pair_ledger_live's "demo mode first" pattern but flipped —
  // set_demo_wallet is a demo-mode-only state mutator.
  if (!isDemoMode()) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: set_demo_wallet refuses outside demo mode; use `pair_ledger_live` to pair a real Ledger" }],
      structuredContent: makeStructuredError("WRONG_MODE", "set_demo_wallet requires VAULTPILOT_DEMO=true or auto-demo"),
    };
  }
  const name = typeof args.persona === "string" ? args.persona : "";
  // Defense-in-depth: the schema enum already restricts to the 4 names;
  // a missing persona at this point is an internal bug, not bad input.
  // BUT we surface as INVALID_INPUT for symmetry with the type system —
  // if a future contributor adds a 5th name to the enum but not PERSONAS,
  // this catches the drift.
  try {
    const persona = setActivePersona(name as Persona["name"]);
    return {
      content: [{ type: "text", text: `active demo persona: ${persona.name} (${persona.address})` }],
      structuredContent: { activePersona: { name: persona.name, address: persona.address, description: persona.description, rehearsableFlows: [...persona.rehearsableFlows] } },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: makeStructuredError("INVALID_INPUT", message),
    };
  }
});
```

**Done criteria:**
- INVERTED `isDemoMode()` gate FIRST — `!isDemoMode()` → `WRONG_MODE` envelope.
- Schema-level enum constraint matches the literal-union in `Persona["name"]` (byte-for-byte).
- Handler catches the `setActivePersona` throw and surfaces as `INVALID_INPUT` (defense-in-depth against schema/registry drift).
- Module side-effect-registers the tool at top level (matches all Phase 2/3/4 tools).

---

### `src/tools/prepare_native_send.ts` (signing-tool, MODIFY demo branch)

**Analog (EXACT — same file):** `src/tools/prepare_native_send.ts:108-131` (current demo branch returns `DEMO_MODE_REFUSED` envelope).

**Current pattern to REPLACE** (`src/tools/prepare_native_send.ts:116-131`):

```typescript
if (isDemoMode()) {
  return {
    isError: true,
    content: [{ type: "text", text: "error: demo mode is active; signing tools refuse in demo mode. ..." }],
    structuredContent: errEnvelope("DEMO_MODE_REFUSED", "demo mode is active; signing tools are disabled"),
  };
}
```

**Replace with** (Q-CONTRADICTION-PREP Option B locked — use persona address as `from`):

```typescript
import { getActivePersona } from "../demo/state.js";
// ... in handler body:
const status = isDemoMode()
  ? buildStatusFromPersona(getActivePersona())  // null persona → WALLET_NOT_PAIRED-style refusal (see below)
  : await getStatus();
if (status === null) {
  return {
    isError: true,
    content: [/* refusal text — demo: "no active persona; call set_demo_wallet" / production: "no Ledger session; call pair_ledger_live" */],
    structuredContent: errEnvelope("WALLET_NOT_PAIRED", /* mode-appropriate message */),
  };
}
// ... rest unchanged: the handler builds tx + fingerprint + handle using `status.address` ...
```

`buildStatusFromPersona(persona: Persona | null): LedgerStatus | null` is a tiny helper (local-scope or extracted to `src/demo/state.ts` — planner picks). Returns `{ paired: true, address: persona.address, chainId: 1, sessionTopicLast8: "demo0000" }` for a non-null persona; returns `null` for null.

**Why `WALLET_NOT_PAIRED` (not a new code) on "no persona active"** — auto-demo seeds whale (Q-AUTO-DEMO-PERSONA-DEFAULT locked), so this branch is unreachable in normal flow. The only way to hit it is explicit `_resetActivePersonaForTesting()` mid-session or an edge case in test wiring. Using `WALLET_NOT_PAIRED` keeps the union flat (no `NO_ACTIVE_PERSONA` code); the message disambiguates ("no active demo persona; call set_demo_wallet").

**Sessions-topic placeholder** — `sessionTopicLast8: "demo0000"` is the sentinel; the downstream `PREPARE RECEIPT` block reads from `args` (not from `status.sessionTopicLast8`), so the placeholder doesn't surface to the user. Defense-in-depth: a regression test asserts the `"demo0000"` sentinel never appears in `result.content[0].text` (so a future contributor who accidentally surfaces session-topic-in-receipt sees the test fail with a tamper-signal-shaped string).

**Done criteria:**
- `if (isDemoMode())` early-return is REMOVED. Replaced with a conditional `status` resolution.
- Persona-derived `status` has `chainId: 1` (matches existing Phase 4 hard-coded mainnet contract).
- All other handler logic (input validation, BigInt parse, fingerprint compute, createHandle, receipt block) runs identically — the persona's address replaces `getStatus().address` as the sole input.
- `Phase 4 test surface change`: `test/prepare-native-send.test.ts:108-127` (test "refuses with DEMO_MODE_REFUSED ...") is REPLACED with "succeeds in demo mode using persona address" — see § Phase 4 Test Surface Changes below.

---

### `src/tools/preview_send.ts` (signing-tool, MODIFY demo branch)

**Analog (EXACT — same file):** `src/tools/preview_send.ts:106-127` (current demo branch returns `DEMO_MODE_REFUSED` envelope).

**Current pattern to REPLACE** (`src/tools/preview_send.ts:112-127`):

```typescript
if (isDemoMode()) {
  return {
    isError: true,
    content: [{ type: "text", text: "error: demo mode is active; preview_send refuses in demo mode. ..." }],
    structuredContent: errEnvelope("DEMO_MODE_REFUSED", "demo mode is active; signing tools are disabled"),
  };
}
```

**Replace with** (mirror `prepare_native_send.ts` evolution above):

```typescript
import { getActivePersona } from "../demo/state.js";
// ... in handler body, AFTER the handle lookup + status guard, AT the `getStatus()` call:
const status = isDemoMode()
  ? buildStatusFromPersona(getActivePersona())
  : await getStatus();
if (status === null) {
  /* refusal envelope as in prepare_native_send */
}
```

The handler's `senderAddress = status.address` line (preview_send.ts:192) is downstream; it consumes the conditional `status` transparently. The three viem reads (`getTransactionCount` / `estimateFeesPerGas` / `estimateGas` at lines 203-218) and `getActiveSessionTopic` ARE STILL CALLED in demo mode against the persona address — the simulation needs accurate nonce / fees / gas for revert detection.

**Critical: viem reads in demo mode** — the `getTransactionCount(client, { address: senderAddress, blockTag: "pending" })` call uses the persona's REAL address against the REAL RPC. This is correct per DEMO-05 (real RPC reads + simulation envelope); the rehearsable flow is genuine, just no broadcast occurs.

**`getActiveSessionTopic` in demo mode** — returns `null` because no WC session exists. preview_send.ts at line ~280 (current send_transaction-side defensive check) doesn't fire on preview because preview doesn't use the WC topic — only send_transaction does. Verify at execute-time the current preview_send DOESN'T call `getActiveSessionTopic`. If it does, that call needs guarding too.

**Done criteria:**
- `if (isDemoMode())` early-return at line 112 is REMOVED.
- Persona-derived `status` flows through the rest of the handler unchanged.
- viem fan-out reads run unchanged (they're already RPC-only — no signing implications).
- `Phase 4 test surface change`: `test/preview-send.test.ts:555-575` (test "VAULTPILOT_DEMO=true → DEMO_MODE_REFUSED ...") is REPLACED with "succeeds in demo mode using persona address; viem reads fire with persona address as `from`" — see § Phase 4 Test Surface Changes.

---

### `src/tools/get_vaultpilot_config_status.ts` (diag-tool, read-only)

**Analog (EXACT):** `src/tools/get_ledger_status.ts:30-53` — read-only, no-error path, structured envelope.

**Imports pattern:**

```typescript
import { isDemoMode } from "../config/env.js";
import { resolveDemoMode } from "../config/demo-resolve.js";
import { getEthereumRpcUrl, getWalletConnectProjectId } from "../config/env.js";
import { getStatus } from "../wallet/session-manager.js";
import { getActivePersona } from "../demo/state.js";
import { registerTool } from "./index.js";
```

**Description pattern** (lock the SECRET-SAFETY contract in the routing prompt):

```typescript
const DESCRIPTION = [
  "Surface VaultPilot runtime configuration as booleans/counts ONLY — never secret values. Use to debug install issues without exposing env-var values to an agent that may relay them.",
  "Returns `{ mode: 'demo' | 'production', autoDemo: boolean, ethereumRpcUrlSet: boolean, walletConnectProjectIdSet: boolean, pairedAccountCount: 0 | 1, walletConnectTopicLast8: string | null, activePersona: string | null }`.",
  "The `ethereumRpcUrlSet` / `walletConnectProjectIdSet` fields are BOOLEANS — the actual URL / key NEVER appears in the response (Information Disclosure mitigation). Use the install --check pass for human-readable validation.",
  "Never errors. Read-only. Works in any mode.",
].join(" ");
```

**Handler body — booleans/counts only** (research § Validation Architecture row 26 lock):

```typescript
registerTool("get_vaultpilot_config_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  const status = await getStatus();
  const persona = getActivePersona();
  const resolution = resolveDemoMode();
  return {
    content: [{ type: "text", text: /* human-readable summary — no values, only field=set/unset */ }],
    structuredContent: {
      mode: isDemoMode() ? "demo" : "production",
      autoDemo: resolution.mode === "auto-demo",
      ethereumRpcUrlSet: Boolean(getEthereumRpcUrl()),
      walletConnectProjectIdSet: Boolean(getWalletConnectProjectId()),
      pairedAccountCount: status === null ? 0 : 1,
      walletConnectTopicLast8: status?.sessionTopicLast8 ?? null,
      activePersona: persona?.name ?? null,
    },
  };
});
```

**Secret-safety regression test pattern** (research § Validation Architecture row 26):
- Test asserts `JSON.stringify(result)` does NOT contain `process.env.ETHEREUM_RPC_URL` substring.
- Test asserts the response includes only the fields listed in the description.

**Done criteria:**
- Returns ONLY booleans / counts / last-8-suffix / persona name. NEVER full URLs / API keys / full topics / full addresses.
- DESCRIPTION explicitly names the secret-safety contract.
- Reads from the SAME `isDemoMode()` predicate the refusal paths read from (coherence — Information Disclosure mitigation in research § Security Domain).

---

### `src/tools/get_ledger_device_info.ts` (diag-tool, inferred-state envelope)

**Analog (partial):** `src/tools/get_ledger_status.ts:30-53` (read-only, structured envelope). The "inferred state, not real probe" surface has NO in-tree precedent — see § No Analog Found note 3.

**Imports pattern:**

```typescript
import { getStatus, getActiveSessionTopic } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";
```

**Description pattern** (lock the "no real probe" honesty in the routing prompt — research § Q-DIAG-02):

```typescript
const DESCRIPTION = [
  "Surface inferred Ledger device state from the WalletConnect session. NOT a true device probe — WalletConnect's Sign protocol doesn't expose app-open / firmware / sealed-device state, so this tool reports what `getStatus()` already knows plus a heuristic for the open app.",
  "Use to diagnose `prepare_*` failures where the user suspects the wrong Ledger app is open. The actionable `hint` field names common remediation steps.",
  "Returns `{ paired: boolean, address: string | null, chainId: number | null, sessionTopicLast8: string | null, appOpen: string | null, firmware: null, hint: string }`. `firmware` is ALWAYS null in v1.0 (WC doesn't expose it; documented residual).",
  "Never errors. Read-only. Works in any mode.",
].join(" ");
```

**Handler body — inferred envelope** (per research § Q-DIAG-02 line 696-707):

```typescript
registerTool("get_ledger_device_info", DESCRIPTION, INPUT_SCHEMA, async () => {
  const status = await getStatus();
  if (status === null) {
    return {
      content: [{ type: "text", text: "paired: false (no Ledger session active)" }],
      structuredContent: {
        paired: false,
        address: null,
        chainId: null,
        sessionTopicLast8: null,
        appOpen: null,
        firmware: null,
        hint: "Call pair_ledger_live to pair a Ledger via WalletConnect; ensure Ledger Live is open and the Ethereum app is loaded on the device.",
      },
    };
  }
  return {
    content: [/* human-readable */],
    structuredContent: {
      paired: true,
      address: status.address,
      chainId: status.chainId,
      sessionTopicLast8: status.sessionTopicLast8,
      appOpen: status.chainId === 1 ? "Ethereum (inferred from CAIP-2 namespace eip155:1)" : null,
      firmware: null,
      hint: "If get_portfolio_summary or prepare_* fails, confirm the Ethereum app is open in Ledger Live → My Ledger → Manage. If pairing dropped, call pair_ledger_live with force: true.",
    },
  };
});
```

**Done criteria:**
- `firmware` is HARD-CODED `null` (no WC method exposes firmware version; documented at research § Q-DIAG-02).
- `appOpen` derived from `status.chainId` via the CAIP-2 namespace heuristic — names the inference explicitly so the agent doesn't mistake it for a real probe.
- DESCRIPTION explicitly states "NOT a true device probe" so the routing agent doesn't promise the user state we can't measure.

---

### `src/tools/register-all.ts` (config, MODIFY +4 lines)

**Analog (EXACT — same file):** `src/tools/register-all.ts:1-12` (current 11 imports across Phases 1-4).

**Current state:**

```typescript
import "./resolve_ens_name.js";
import "./reverse_resolve_ens.js";
import "./get_token_balance.js";
import "./get_transaction_status.js";
import "./get_portfolio_summary.js";
import "./pair_ledger_live.js";
import "./get_ledger_status.js";
import "./prepare_native_send.js";
import "./preview_send.js";
import "./send_transaction.js";
import "./get_tx_verification.js";
```

**Add EXACTLY 4 import lines** above the `export function registerAllTools()` line:

```typescript
import "./get_demo_wallet.js";
import "./set_demo_wallet.js";
import "./get_vaultpilot_config_status.js";
import "./get_ledger_device_info.js";
```

Order: demo tools first (Plan 05-01 owns them), then diag tools (Plan 05-03 owns them) — matches plan order. Within-plan order: `get_*` before `set_*` (matches Phase 4's `prepare_*` → `preview_*` → `send_*` order convention).

**Done criteria:**
- 4 new lines; 0 reordering of existing imports.
- The trailing comment "Tool modules register on import. Phase 2+ adds imports above this comment." is preserved.

---

### `src/diagnostics/update-check.ts` (diag-fetch, fire-and-forget HTTP)

**Analog (partial):** `src/clients/fourbyte.ts:69-130` — HTTP fetch + AbortController + result envelope. STRUCTURALLY DIFFERENT (no return value, no cache, fire-and-forget) — see § No Analog Found note 4.

**Imports pattern** (mirror `src/clients/fourbyte.ts:30-32`):

```typescript
import { log } from "./logger.js";
```

NO viem / no signing imports. Pure HTTP + log module.

**Fire-and-forget pattern** (research § Code Example, line 491-535):

```typescript
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
  log("warn", `vaultpilot-mcp v${currentVersion} → v${body.version} available; run \`npm i -g vaultpilot-mcp\` to update`);
}

export function _resetUpdateCheckForTesting(): void {
  fired = false;
}
```

**Differences from `fourbyte.ts`:**
- `AbortSignal.timeout(2000)` instead of manual `new AbortController() + setTimeout`. Cleaner; same effect. Both Node 18+ built-ins.
- NO cache (Map). Once-per-process flag (`let fired = false`).
- Returns `void`; the fetch result is consumed via `log(...)` side-effect inside the async function.
- The `.catch(() => {})` swallows failures silently — by design (research § Pitfall 3: a slow npm registry must NEVER block the boot path).

**Done criteria:**
- `fired` flag is module-scoped `let`, NOT a Map — single boolean.
- `VAULTPILOT_DISABLE_UPDATE_CHECK=1` literal check (NOT `Boolean(...)`); matches the `VAULTPILOT_DEMO === "true"` strict-literal pattern.
- Fetch result is `log("info" | "warn", ...)` only — NEVER stdout, NEVER an Error throw.
- 2s `AbortSignal.timeout` (NOT a 1.5s like fourbyte — npm registry can be slower).
- `_resetUpdateCheckForTesting()` exported for test isolation.

---

### `src/diagnostics/notice.ts` (diag-template, constants)

**Analog (EXACT):** `src/tools/pair_ledger_live.ts:51-61` (`VERIFY_ON_DEVICE_TEMPLATE`). Same format-fanout-sentinel pattern.

**Imports pattern:** none required (pure data module).

**Format-fanout-sentinel pattern** (`src/tools/pair_ledger_live.ts:51-61`):

```typescript
export const VERIFY_ON_DEVICE_TEMPLATE: string = [
  "VERIFY-ON-DEVICE",
  "  Address: {ADDRESS}",
  // ...
].join("\n");
```

Apply (per research § Pattern 2 line 176-185):

```typescript
/**
 * Verbatim AUTO-DEMO NOTICE block. Format-fanout-sentinel:
 * `test/notice.test.ts` imports this const, substitutes the same way the
 * dispatcher wrap does, and asserts byte-identity against the prepended
 * block. Do NOT duplicate the string into any consumer; ALL callers
 * (`src/server.ts` dispatcher wrap, the auto-demo integration test) import
 * THIS const.
 */
export const AUTO_DEMO_NOTICE_TEMPLATE: string = [
  "VAULTPILOT NOTICE — Auto demo mode active",
  "",
  "  No config file at ~/.vaultpilot-mcp/config.json and VAULTPILOT_DEMO is unset.",
  "  Booting into demo mode with curated personas (active: {PERSONA}).",
  "  Signing tools simulate against persona addresses; reads work against real RPC.",
  "",
  "  To exit demo mode: set VAULTPILOT_DEMO=false in your env, OR create",
  "  ~/.vaultpilot-mcp/config.json with { \"demo\": false }.",
  "  To switch personas: call set_demo_wallet({ persona: \"<name>\" }).",
].join("\n");
```

**Substitution rule** (matches `src/tools/pair_ledger_live.ts:109-111`):

```typescript
const notice = AUTO_DEMO_NOTICE_TEMPLATE.replace("{PERSONA}", activePersona?.name ?? "whale");
```

**Module-scoped emission flag** (analogous to update-check.ts's `let fired = false`):

```typescript
let firstResponseEmitted = false;

export function shouldEmitAutoDemoNotice(isAutoDemo: boolean): boolean {
  if (firstResponseEmitted) return false;
  firstResponseEmitted = true;
  return isAutoDemo;
}

export function _resetAutoDemoNoticeForTesting(): void {
  firstResponseEmitted = false;
}
```

**Critical race-condition guard** (research § Pitfall 4): `firstResponseEmitted = true` happens BEFORE the `return isAutoDemo` check inside the function — the "first wins" semantics. Two concurrent tool calls both call this; the SECOND call's `firstResponseEmitted` is already true (set by the first), so it returns false. Only the first call gets the NOTICE.

**Done criteria:**
- `AUTO_DEMO_NOTICE_TEMPLATE` is a multi-line `.join("\n")` string with `{PERSONA}` placeholder.
- `shouldEmitAutoDemoNotice()` sets the flag BEFORE returning (race-safety per research § Pitfall 4).
- `_resetAutoDemoNoticeForTesting()` exported.
- Template is the SOT — tests + dispatcher wrap BOTH import this const.

---

### `src/server.ts` (dispatcher-wrap, MODIFY)

**Analog (EXACT — same file):** `src/server.ts:76-107` (existing CallToolRequest dispatcher with ajv gate). Phase 4 set the precedent: middleware lives at the SDK boundary, not in per-tool handlers.

**Current pattern** (`src/server.ts:76-107`):

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const tool = getRegisteredTool(name);
  // ... ajv validation ...
  try {
    return await tool.handler(args ?? {});
  } catch (err) {
    // ... error handling ...
  }
});
```

**Wrap with NOTICE prepend** (per research § Code Example "Plan 05-03: First-response NOTICE intercept" line 541-560):

```typescript
import { isAutoDemo } from "./config/demo-resolve.js";
import { AUTO_DEMO_NOTICE_TEMPLATE, shouldEmitAutoDemoNotice } from "./diagnostics/notice.js";
import { getActivePersona } from "./demo/state.js";

// inside the existing dispatcher body, AFTER `tool.handler(args ?? {})` resolves:
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  // ... existing tool lookup + ajv gate (UNCHANGED) ...
  let handlerResult: CallToolResult;
  try {
    handlerResult = await tool.handler(args ?? {});
  } catch (err) {
    /* existing error handling — UNCHANGED */
  }
  // Wave 0 NEW: prepend AUTO_DEMO NOTICE on the very first tool response of
  // the session iff the resolver picked the auto-demo arm. Set the flag
  // BEFORE awaiting (Pitfall 4 — handled inside shouldEmitAutoDemoNotice).
  if (shouldEmitAutoDemoNotice(isAutoDemo())) {
    const activePersona = getActivePersona();
    const noticeText = AUTO_DEMO_NOTICE_TEMPLATE.replace("{PERSONA}", activePersona?.name ?? "whale");
    const noticeBlock = { type: "text" as const, text: noticeText };
    handlerResult.content = [noticeBlock, ...handlerResult.content];
  }
  return handlerResult;
});
```

**INSTRUCTIONS field — verify-only per research § A7** — Plan 05-03 reads `src/server.ts:28-32` and decides whether the post-Phase-4 text reads correctly. If it does (likely — it mentions "prepare tools" generically), no edit. If it doesn't, REWRITE to mention payloadFingerprint / LEDGER BLIND-SIGN HASH / previewToken explicitly. Either way, this is a low-touch verification.

**Why one dispatcher wrap (not per-tool gates)** — per research § Anti-Patterns: "Per-tool first-response gate — wrapping each handler with 'did NOTICE fire yet?' check duplicates state across N handlers. Wrap the dispatcher in `src/server.ts` instead." Same scope as Phase 4's ajv gate.

**Done criteria:**
- Existing dispatcher body (lookup → ajv → handler.dispatch) UNCHANGED.
- NOTICE prepend wraps the existing return — minimal-surface edit.
- `shouldEmitAutoDemoNotice` flag is set BEFORE the conditional return (race-safety from `notice.ts`).
- INSTRUCTIONS rewrite happens IFF post-verification finds the text stale.

---

### `src/index.ts` (boot-wiring, MODIFY)

**Analog (EXACT — same file):** `src/index.ts` (current entrypoint).

**Imports added:**

```typescript
import { isAutoDemo, resolveDemoMode } from "./config/demo-resolve.js";
import { setActivePersona } from "./demo/state.js";
import { runUpdateCheckOnce } from "./diagnostics/update-check.js";
```

**Boot-wiring pattern** (research § Code Example "Plan 05-03: Update check" line 491-535 + the Q-AUTO-DEMO-PERSONA-DEFAULT auto-seed):

```typescript
// near top of startServer body, BEFORE buildServer():
// Resolve demo mode once at boot (idempotent — cached for the process lifetime).
resolveDemoMode();
// Q-AUTO-DEMO-PERSONA-DEFAULT: seed whale as the default in auto-demo mode.
if (isAutoDemo()) {
  setActivePersona("whale");
}
// DIAG-04: fire update check at boot. Fire-and-forget; the check never blocks.
runUpdateCheckOnce(SERVER_VERSION, "vaultpilot-mcp");  // SERVER_VERSION from src/server.ts; planner picks the import path
```

**Done criteria:**
- Three calls added at boot, BEFORE the stdio transport `connect` call.
- Update-check fired with `(currentVersion, packageName)` — packageName from `package.json::name` (research § Q-NPM open question).
- Auto-demo seed happens IFF `isAutoDemo()` returns true (NOT for `env-on` / `config-on`).

---

### `test/helpers/mock-config-file.ts` (test-helper, factory)

**Analog (partial — role only):** `test/helpers/mock-public-client.ts` (factory + `_set*` driver methods + cleanup).

**Imports pattern:**

```typescript
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

**Factory shape pattern** (per research § Wave 0 Gaps line 626):

```typescript
export interface MockConfigFile {
  /** Absolute path to the temporary config.json that the demo-resolve code reads. */
  path: string;
  /** Cleanup function — call in afterAll/afterEach to remove the temp directory. */
  cleanup(): void;
}

export function mockConfigFile(contents: object): MockConfigFile {
  const dir = mkdtempSync(join(tmpdir(), "vaultpilot-mock-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(contents), "utf8");
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
```

**Path-injection pattern** (research § Pitfall 2): the test sets `HOME` env var to the temp directory's parent BEFORE calling `_resetDemoModeForTesting()`. The `homedir()` call inside `demo-resolve.ts::getConfigPath()` returns the overridden path. Alternative: `_resetDemoModeForTesting({ configPath: override })` parameter — planner picks the cleaner option at execute time.

**Done criteria:**
- Module exports `mockConfigFile(contents: object): MockConfigFile`.
- NEVER touches `~/.vaultpilot-mcp/` (the real home directory) — uses `mkdtempSync` for isolation.
- Cleanup is callable multiple times (idempotent — `rmSync({ force: true })`).
- The helper sets up filesystem state ONLY; it does NOT call `_resetDemoModeForTesting` (that's the test's job, ordered AFTER the mock is set up).

---

### `test/demo-state.test.ts` (test — unit + reset between tests)

**Analog:** `test/wallet-session-manager.test.ts` (module-state + `_reset*ForTesting` between tests).

**Test cases** (per research § Wave 0 Gaps + Validation Architecture):

1. **Persona registry shape**: assert `PERSONAS.length === 4`; assert all 4 expected `name` values present; assert all addresses round-trip through `getAddress()` (EIP-55 byte-identity).
2. **`getActivePersona` initial state**: returns `null` after `_resetActivePersonaForTesting()`.
3. **`setActivePersona("whale")`**: returns the whale persona; subsequent `getActivePersona()` returns it.
4. **`setActivePersona("unknown")`**: throws `Error` with "unknown persona" in message.
5. **`_resetActivePersonaForTesting()`**: clears state; subsequent `getActivePersona()` returns `null`.

**Done criteria:**
- ≥ 5 `it(...)` cases.
- Each test calls `_resetActivePersonaForTesting()` in `beforeEach`.
- No filesystem / network mocking required.

---

### `test/demo-resolution.test.ts` (test — env + fs decision tree)

**Analog (EXACT role):** `test/check-doctor.test.ts` (env-var + filesystem assertions).

**Imports pattern** (mirror `test/check-doctor.test.ts` setup pattern):

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockConfigFile } from "./helpers/mock-config-file.js";
import { _resetDemoModeForTesting, isDemoMode, isAutoDemo, resolveDemoMode } from "../src/config/demo-resolve.js";
```

**Test cases** (exhaustive decision tree per research § Validation Architecture):

1. **ENV `VAULTPILOT_DEMO=true` → demo on**: assert `resolveDemoMode().mode === "env-on"`.
2. **ENV `VAULTPILOT_DEMO=false` → demo off**: assert `resolveDemoMode().mode === "env-off"`.
3. **ENV `VAULTPILOT_DEMO=True` (capitalized) → process.exit(1)**: spy on `process.exit`; assert called with 1.
4. **ENV `VAULTPILOT_DEMO=1` → process.exit(1)**: same.
5. **ENV unset + file missing → auto-demo**: assert `resolveDemoMode().mode === "auto-demo"`.
6. **ENV unset + file with `{ "demo": true }` → demo on**: use mockConfigFile + HOME override.
7. **ENV unset + file with `{ "demo": false }` → demo off**.
8. **ENV unset + file with no `demo` key → boot-real (no auto-demo)** — Q-A2 locked.
9. **ENV unset + malformed JSON → process.exit(1)**: spy on `process.exit`.
10. **Caching**: call `resolveDemoMode()` twice; assert subsequent call hits the cache (no `readFileSync` re-invocation).

**`process.exit` spy pattern**: `vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit(${code})`); })` so the test can assert the call without actually exiting. Mirror this pattern from any in-tree test that already spies on it (Phase 5 may be the first — call it out in the test's top comment).

**Done criteria:**
- ≥ 10 `it(...)` cases.
- Each test calls `_resetDemoModeForTesting()` in `beforeEach`.
- `mockConfigFile()` + HOME override used for filesystem-state tests.
- `process.exit` spy used for refuse-to-boot tests.

---

### `test/get-demo-wallet.test.ts` (test — read-only tool)

**Analog (EXACT):** `test/get-ledger-status.test.ts` (read-only, no-error path).

**Test cases:**

1. **Lists 4 personas**: call tool; assert `structuredContent.personas.length === 4`; assert all 4 names present.
2. **`activePersona: null` when none active**: assert structured field.
3. **`activePersona: "whale"` after setActivePersona**: set persona via internal API; assert tool surfaces it.
4. **`mode: "production"` when not in demo mode**: assert field.
5. **`mode: "demo"` when `VAULTPILOT_DEMO=true`**: env-toggle test.

**Done criteria:**
- ≥ 5 `it(...)` cases.
- `_resetActivePersonaForTesting` + `_resetDemoModeForTesting` in beforeEach.
- No mocking of viem / session-manager required (the tool reads from `demo/state.ts` + `config/env.ts` only).

---

### `test/set-demo-wallet.test.ts` (test — state mutation + mode-gate)

**Analog (EXACT role):** `test/pair-ledger-live.test.ts:187-227` (env-toggle pattern + structured errorCode assertions).

**Test cases:**

1. **Happy path**: `VAULTPILOT_DEMO=true`; call `set_demo_wallet({ persona: "whale" })`; assert `getActivePersona().name === "whale"`; assert structuredContent envelope shape.
2. **WRONG_MODE in non-demo mode**: env unset; call tool; assert `errorCode: "WRONG_MODE"`; assert `getActivePersona() === null` (state UNCHANGED).
3. **INVALID_INPUT for unknown persona**: schema-enum rejects at MCP boundary BEFORE handler runs — test the schema's `enum` lockdown.
4. **State persists across multiple calls**: set whale; call get_demo_wallet; verify whale is active; set defi-degen; verify defi-degen is active.

**Done criteria:**
- ≥ 4 `it(...)` cases.
- WRONG_MODE test asserts state UNCHANGED (defense-in-depth — refusal must not leak partial mutation).
- INVALID_INPUT test exercises schema-level enum (matches Phase 4's `userDecision: "yes"` schema-gate test at `test/send-transaction.test.ts`).

---

### `test/get-vaultpilot-config-status.test.ts` (test — env-controlled state + secret-safety)

**Analog (EXACT role):** `test/check-doctor.test.ts` (env-controlled fields) + `test/get-ledger-status.test.ts` (structured-envelope assertions).

**Test cases:**

1. **Returns exact field set** (DIAG-01 contract): assert the response has exactly the 7 fields listed in the description.
2. **`ethereumRpcUrlSet: true` when `ETHEREUM_RPC_URL` env var set**.
3. **`ethereumRpcUrlSet: false` when unset**.
4. **`mode: "demo"` coherence with refusal paths** (Information Disclosure mitigation per research § Security Domain): when `VAULTPILOT_DEMO=true`, calling `pair_ledger_live` AND `get_vaultpilot_config_status` returns coherent state — `mode: "demo"` + `errorCode: "DEMO_MODE_REFUSED"`.
5. **`SECRET-SAFETY REGRESSION TEST`** (research § Validation Architecture row 26): set `ETHEREUM_RPC_URL="https://my-secret-rpc.example.com/xyz123"`; call tool; assert `JSON.stringify(result).includes("https://my-secret-rpc.example.com")` is **FALSE**. Same for `WALLETCONNECT_PROJECT_ID`.

**Done criteria:**
- ≥ 5 `it(...)` cases.
- The SECRET-SAFETY test is the LOAD-BEARING regression anchor (the V8 Data Protection ASVS row).
- All env vars saved + restored in beforeEach/afterEach (no test cross-contamination).

---

### `test/get-ledger-device-info.test.ts` (test — paired / unpaired envelope)

**Analog (EXACT):** `test/get-ledger-status.test.ts` (paired/unpaired structured envelope).

**Test cases:**

1. **Unpaired envelope**: `getStatus` returns null; assert `paired: false`, all other fields null, `hint` mentions `pair_ledger_live`.
2. **Paired envelope**: `getStatus` returns a fixture status; assert all fields populated; `appOpen` mentions "Ethereum"; `firmware: null`.
3. **`appOpen` heuristic**: `chainId: 1` → appOpen mentions "Ethereum"; `chainId: 137` → appOpen is null (Phase 5 only supports mainnet inference per Phase 4 limit).
4. **`firmware` is ALWAYS null**: regression anchor — assert the field is null in both paired and unpaired branches.

**Done criteria:**
- ≥ 4 `it(...)` cases.
- Uses `vi.importActual` overlay on `../src/wallet/session-manager.js` (mirrors `test/pair-ledger-live.test.ts:11-21`).

---

### `test/update-check.test.ts` (test — global fetch mock + fake timers + once-per-process flag)

**Analog:** `test/pricing-defillama.test.ts` (mocked global `fetch`); `test/fourbyte.test.ts` (AbortController + fake timers).

**Test cases** (research § Validation Architecture lines 597-600):

1. **Fires once per process**: call `runUpdateCheckOnce` three times; assert global `fetch` called exactly once.
2. **`VAULTPILOT_DISABLE_UPDATE_CHECK=1` suppresses**: env set; call; assert `fetch` NOT called.
3. **Up-to-date version**: mock fetch returns `{ version: currentVersion }`; assert `log("info", ...)` called with "up to date".
4. **New version available**: mock fetch returns `{ version: "9.9.9" }`; assert `log("warn", ...)` called with "available" + upgrade hint.
5. **HTTP 5xx → silent**: mock fetch returns `{ ok: false, status: 500 }`; assert NO log line, NO throw.
6. **Network error → silent**: mock fetch rejects with `new Error("ENOTFOUND")`; assert NO log line, NO throw.
7. **Timeout → silent**: mock fetch to never resolve; advance fake timers past 2s; assert NO throw, NO uncaught rejection.

**Done criteria:**
- ≥ 7 `it(...)` cases.
- `_resetUpdateCheckForTesting()` in beforeEach.
- `vi.stubGlobal("fetch", ...)` for fetch mocking.
- Fake timers + `vi.advanceTimersByTimeAsync` for the timeout test.

---

### `test/notice.test.ts` (test — block-shape + dispatcher integration)

**Analog (partial — block-shape only):** `test/signing-blocks.test.ts` (template-shape sanity).

**Test cases:**

1. **`AUTO_DEMO_NOTICE_TEMPLATE` shape**: assert non-empty; assert contains `{PERSONA}` placeholder.
2. **Substitution leaves no leftover placeholders**: `AUTO_DEMO_NOTICE_TEMPLATE.replace("{PERSONA}", "whale")` returns a string with no `/\{[A-Z_]+\}/` matches.
3. **`shouldEmitAutoDemoNotice` first-call semantics**: reset; call with `isAutoDemo=true`; returns true; subsequent call (any arg) returns false.
4. **Race-condition flag set BEFORE return**: spy / instrument the flag; assert first concurrent call returns true; second concurrent call returns false; both observe `firstResponseEmitted === true` after the first returns.

**For DEMO-07 integration testing** — `test/auto-demo-notice.test.ts` (separate file, optional per research § Wave 0 Gaps) OR fold into `test/demo-flow.integration.test.ts` — assert the NOTICE block is prepended to the FIRST tool response in an auto-demo session.

**Done criteria:**
- ≥ 4 `it(...)` cases.
- `_resetAutoDemoNoticeForTesting()` in beforeEach.
- Imports `AUTO_DEMO_NOTICE_TEMPLATE` directly (format-fanout — no string duplication).

---

### `test/demo-flow.integration.test.ts` (test — integration; mirror trust-pipeline shape)

**Analog (EXACT role):** `test/trust-pipeline.integration.test.ts` (full pipeline against 2 mocked SDKs + real handle store).

**Composition pattern** (`test/trust-pipeline.integration.test.ts:39-87`):

```typescript
// Mock viem/actions, session-manager, walletconnect-client via vi.hoisted + vi.mock overlays.
// Walk: prepare_native_send → preview_send → send_transaction.
// Assert: payloadFingerprint byte-identical across all 3 responses;
// signClient.request called with EXACT pinned params.
```

**Apply for Phase 5 demo flow** (research § Wave 0 Gaps line 619):

```typescript
// Mock viem/actions (createMockPublicClient).
// Mock session-manager getStatus → null (no real pair).
// Setup: VAULTPILOT_DEMO=true; setActivePersona("whale").
// Walk:
//   1. set_demo_wallet({ persona: "whale" }) → active persona set.
//   2. get_portfolio_summary() → reads against whale's REAL address via mocked viem.
//   3. prepare_native_send({ to: ..., valueWei: ... }) → succeeds in demo mode; uses whale.address as `from`.
//   4. preview_send({ handle }) → succeeds; viem reads fire with whale.address; LEDGER BLIND-SIGN HASH block emitted.
//   5. send_transaction({ handle, previewToken, userDecision: "send" }) → SIMULATION envelope; signClient.request NOT called.
// Assert:
//   - all 5 tools succeed (no DEMO_MODE_REFUSED anywhere).
//   - the simulation envelope's `from` field (passed to viem.call) === whale.address.
//   - signClient.request NEVER called (no real broadcast).
```

**Critical assertion** (the Q-CONTRADICTION-PREP Option B truth-claim): every tool in the chain accepts the persona address as the implicit signer; no DEMO_MODE_REFUSED appears in any step's response. This integration test is the load-bearing assertion that the demo flow is rehearsable end-to-end.

**Done criteria:**
- ONE comprehensive `it(...)` walking the full demo flow.
- Composes mock-public-client (Phase 4 helper).
- Sets `VAULTPILOT_DEMO=true` + activates whale at test setup.
- Asserts `signClient.request` spy is at 0 calls at the end.

## Shared Patterns

### Logging (stderr-only)

**Source:** `src/diagnostics/logger.ts:3-5`
**Apply to:** `src/config/demo-resolve.ts` (refuse-to-boot errors); `src/diagnostics/update-check.ts` (info/warn on version state).

```typescript
import { log } from "../diagnostics/logger.js";
log("error", `VAULTPILOT_DEMO must be literal "true" or "false"; got "${envRaw}". Refusing to boot.`);
log("warn", `vaultpilot-mcp v${currentVersion} → v${body.version} available; ...`);
```

**Rule:** stderr for diagnostics, stdout for MCP protocol. NEVER `console.log`. NEVER `process.stderr.write` directly.

### Structured errorCode envelope (Phase 4 convention, extend by 1)

**Source:** `src/signing/error-codes.ts:50-65` (`makeStructuredError`)
**Apply to:** `src/tools/set_demo_wallet.ts` (WRONG_MODE + INVALID_INPUT envelopes).

```typescript
import { makeStructuredError } from "../signing/error-codes.js";
return {
  isError: true,
  content: [{ type: "text", text: "error: ..." }],
  structuredContent: makeStructuredError("WRONG_MODE", "set_demo_wallet requires VAULTPILOT_DEMO=true or auto-demo"),
};
```

### Format-fanout-regex-sync (CLAUDE.md global rule)

**Source:** `src/tools/pair_ledger_live.ts:51-61` (`VERIFY_ON_DEVICE_TEMPLATE`)
**Apply to:** `src/diagnostics/notice.ts` (`AUTO_DEMO_NOTICE_TEMPLATE`). EVERY test that asserts NOTICE content imports the SAME const + substitutes the same way the dispatcher does. `.toContain(...)` against an inline string literal is BANNED.

### Side-effect-import tool registration

**Source:** `src/tools/register-all.ts:1-12`
**Apply to:** `get_demo_wallet`, `set_demo_wallet`, `get_vaultpilot_config_status`, `get_ledger_device_info` — each registers at module top level; `register-all.ts` gains one import line per tool.

### Lazy-singleton with `_resetForTesting()`

**Source:** `src/chains/ethereum.ts:9-44`
**Apply to:** `src/config/demo-resolve.ts` (cached resolution result); `src/diagnostics/update-check.ts` (once-per-process flag); `src/demo/state.ts` (mutable single-value).

Three different shapes (one is a 6-arm discriminated union, one is a boolean flag, one is a `Persona | null`); all three share the "cache + reset helper" convention.

### Tool-handler return shape

**Source:** `src/tools/index.ts:14-19`
**Apply to:** every Phase 5 tool handler. Always populate BOTH `content` (human-readable) AND `structuredContent` (agent-routable). On error, BOTH still populated (errorCode in structuredContent; error text in content).

### Test mock setup convention

**Source:** `test/get-token-balance.test.ts:3-12, 21-24` (`__client` export trick) + `test/pair-ledger-live.test.ts:11-21` (`vi.importActual` overlay) + `test/preview-send.test.ts:30-42` (`vi.hoisted` shared spies)
**Apply to:** all Phase 5 unit tests with mock dependencies.

- `vi.mock(...)` calls hoisted before `import` statements; spies inside `vi.hoisted()`.
- For SDK / 3rd-party module mocks: full replacement.
- For internal module mocks: `vi.importActual` overlay — keep type exports + error classes REAL.
- `_reset*ForTesting()` in `beforeEach`.
- Each test file calls `import "../src/tools/register-all.js"` after mocks to trigger registration under the mocks.

### Env-var test toggle pattern

**Source:** `test/pair-ledger-live.test.ts:39-69, 187-227`
**Apply to:** every Phase 5 test that toggles `VAULTPILOT_DEMO` or `VAULTPILOT_DISABLE_UPDATE_CHECK`.

```typescript
const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;
beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  delete process.env[DEMO_KEY];
});
afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
});
```

Preserves CI environment hygiene; passes the strict-literal regression at `test/pair-ledger-live.test.ts:207`.

## Phase 3 / 4 Conventions To Preserve

Per-line summaries of conventions Phase 5 inherits without reshape:

- **NodeNext ESM imports** — relative imports use `.js` extension (compiled output); `import type` for type-only. Built-in modules use `node:` prefix.
- **`as const` on schema `type: "object"`** — `src/tools/get_token_balance.ts:14`. Keep on all 4 new tools.
- **`additionalProperties: false` on every inputSchema** — locks the wire shape against future-arg-injection drift.
- **DESCRIPTION as array-of-paragraphs joined by spaces** — minimum 100 chars; covers WHAT + WHEN + WHEN-NOT + return shape + failure modes.
- **Schema-level enum on persona arg** — `enum: ["whale", "defi-degen", "stable-saver", "staking-maxi"]` matches the literal-union in `Persona["name"]`. The ajv gate at `src/server.ts:55-66` enforces it BEFORE the handler runs (Phase 4 precedent for `userDecision: ["send", "cancel"]`).
- **`isDemoMode()` short-circuit FIRST in every signing handler** — preserved for `pair_ledger_live` + `get_tx_verification`. INVERTED to "delegate to persona address" for `prepare_native_send` + `preview_send`. `send_transaction`'s existing demo branch (the simulation envelope) becomes reachable.
- **`getStatus()` short-circuits to null without triggering init** — preserved; `get_ledger_device_info` reuses this property.
- **No new Error classes** — Phase 5 emits NO `instanceof`-dispatched errors. All failure paths surface via structured `errorCode` in `structuredContent` (matches Phase 4 convention; Phase 3 was the last phase to add custom Error subclasses).
- **`crypto.randomUUID()` for one-time tokens** — not used in Phase 5 (no new handles minted; persona names are stable strings).
- **`bigint`-native arithmetic via viem** — preserved; persona addresses are 20-byte `Address` types, not bigints.
- **Test file naming** — `<feature>.test.ts` directly under `test/`; helpers under `test/helpers/`. No nested directories.
- **Fake-timer pattern** — `vi.useFakeTimers()` per-test; `vi.useRealTimers()` in `afterEach`. Used by `test/update-check.test.ts` for the 2s timeout test.
- **Strict-literal env checks** — `process.env.VAULTPILOT_DEMO === "true"` (NOT `.toLowerCase()`); same rule for `VAULTPILOT_DISABLE_UPDATE_CHECK === "1"`.
- **Stderr for diagnostics, stdout for MCP protocol** — never `console.*`; always through `log(...)`.

## No Analog Found

The Phase 5 planner MUST call these out explicitly so a later phase doesn't accidentally restyle them.

### Note 1: Filesystem-config-read at boot

**File:** `src/config/demo-resolve.ts`
**Why no analog:** `src/diagnostics/check.ts:96-124` reads the same `~/.vaultpilot-mcp/config.json` BUT only as a one-shot CLI doctor pass (returns a `CheckResult` envelope; never blocks boot; malformed → "warn" level). Phase 5's `demo-resolve.ts` reads the SAME file but during the production boot path with STRICT refusal on malformed JSON — `process.exit(1)` rather than fall-through. The strict semantics are a deliberate divergence from check.ts.

**Pattern to lock:**
- Sync `readFileSync` at boot — one-shot, file < 1 KB. Matches research § Standard Stack line 41.
- Malformed JSON → `log("error", "...")` + `process.exit(1)`. NEVER fall through to auto-detect.
- The `getConfigPath()` helper is the SOT for the path — `src/diagnostics/check.ts` imports it (format-fanout-regex-sync rule from global CLAUDE.md).
- The cache (`let cached: ResolutionResult | undefined`) lives in `demo-resolve.ts`, NOT in `check.ts` — check.ts is one-shot at boot; demo-resolve is hit repeatedly during signing-flow refusals.

### Note 2: Module-scoped mutable single-value state

**File:** `src/demo/state.ts`
**Why no analog:** Phase 3's `src/wallet/session-manager.ts:108-110` has multi-field module state (`inFlightApproval` + `cachedSessionTopic` + `sessionDeleteListenerRegistered`) cleared by ONE reset helper. Phase 5's persona state is a SINGLE field (`activePersona: Persona | null`) with no listeners, no concurrent-access concerns. The shape is simpler — but it's the FIRST in-tree module that mutates state via a separate setter (the session-manager mutates state as a side effect of `pair()`, not via an explicit setter).

**Pattern to lock:**
- Single `let activePersona: Persona | null = null` at module scope.
- `getActivePersona()` returns the current value (no defensive copy — `Persona` is `readonly`).
- `setActivePersona(name)` throws on unknown name (the tool handler catches + surfaces as INVALID_INPUT envelope).
- `_resetActivePersonaForTesting()` clears the state.
- The module is PURE — no `isDemoMode()` checks (tool handlers enforce mode-gating; state module is mode-agnostic for testability).

### Note 3: Inferred-state diagnostic envelope

**File:** `src/tools/get_ledger_device_info.ts`
**Why no analog:** Phase 3's `get_ledger_status` returns REAL session state — it knows what it knows from the WC session store. Phase 5's `get_ledger_device_info` returns INFERRED state — the WC Sign protocol exposes no method for app-open / firmware / sealed-device introspection (research § Q-DIAG-02). The tool returns a "best-guess" envelope with explicit inference labels (`appOpen: "Ethereum (inferred from CAIP-2 namespace eip155:1)"`) + a `hint` field that compensates for the missing probe surface.

**Pattern to lock:**
- The tool's DESCRIPTION explicitly states "NOT a true device probe" so the agent doesn't promise the user state we can't measure.
- Inferred fields are LABELED with the inference source (`(inferred from CAIP-2 namespace ...)`) — readability over brevity.
- The `hint` field is the actionable compensation for missing probe data — names common remediation steps.
- `firmware` is hard-coded `null` (DOCUMENTED RESIDUAL — WC doesn't expose firmware; will surface in v2.x USB-HID flows when the transport changes).

This pattern WILL re-emerge in v2.x for Solana / TRON / BTC USB-HID device probes; lock it now so the planner has a reference.

### Note 4: Fire-and-forget background fetch

**File:** `src/diagnostics/update-check.ts`
**Why no analog:** Phase 4's `src/clients/fourbyte.ts` has the closest shape — HTTP fetch + AbortController + result envelope. STRUCTURAL DIFFERENCES:
- fourbyte RETURNS a `FourbyteResult` to the caller (consumed by preview_send).
- update-check returns `void`; the result is consumed via `log(...)` side-effect.
- fourbyte has a 256-entry LRU cache.
- update-check has a single `let fired = false` flag (once-per-process semantics).
- fourbyte has a 1.5s timeout (used at preview time — back-pressure matters).
- update-check has a 2s timeout (used at boot — cleanup matters, not back-pressure).
- fourbyte's catch surfaces error to caller via `{ kind: "error", message }`.
- update-check's catch is `() => {}` — silent.

**Pattern to lock:**
- Once-per-process flag (`let fired = false`) at module scope; set BEFORE the async call so concurrent invocations short-circuit.
- `.catch(() => {})` on the fire-and-forget Promise — silent on failure, NEVER throws to the caller, NEVER produces an uncaught rejection.
- `AbortSignal.timeout(2000)` instead of manual `AbortController + setTimeout` — Node 18+ built-in; cleaner shape than fourbyte's pattern.
- Result consumed via `log(...)` side-effect — stderr-only, never stdout.
- `VAULTPILOT_DISABLE_UPDATE_CHECK=1` strict-literal opt-out — matches `VAULTPILOT_DEMO === "true"` rule.

### Note 5: Dispatcher-wrap for response middleware

**File:** `src/server.ts` (MODIFY)
**Why no analog:** Phase 4's `AjvJsonSchemaValidator` gate at `src/server.ts:55-66` is the precedent for "middleware lives at the SDK boundary, not in per-tool handlers" — BUT that's an INPUT gate (validates `args` BEFORE the handler runs). Phase 5's NOTICE prepend is an OUTPUT wrap (modifies `handlerResult.content` AFTER the handler resolves). Same scope (SDK boundary at the `setRequestHandler` callback), different position (post-handler).

**Pattern to lock:**
- The dispatcher wrap reads from `isAutoDemo()` (NOT from `isDemoMode()`) — research § A3 locked: NOTICE fires ONLY on the auto-detect arm, NOT on explicit env-on / config-on.
- The race-condition guard (flag set BEFORE the conditional return) lives in `notice.ts::shouldEmitAutoDemoNotice`, NOT in the dispatcher — keeps `server.ts` thin.
- The dispatcher wrap is the SOLE consumer of `shouldEmitAutoDemoNotice` in production code. Tests import it directly to exercise the flag's state machine.
- NO per-tool gates — every tool handler stays mode-agnostic on the NOTICE concern.

### Note 6: `WRONG_MODE` errorCode (mode-lifecycle refusal)

**File:** `src/signing/error-codes.ts` (MODIFY)
**Why no analog:** Phase 4's 13 codes cover state-machine concerns (`WRONG_STATUS`, `HANDLE_NOT_FOUND`), input-shape concerns (`INVALID_INPUT`), and runtime concerns (`DEMO_MODE_REFUSED`, `BROADCAST_FAILED`, `LEDGER_REJECTED`). `WRONG_MODE` is a NEW category: mode-LIFECYCLE refusal. Specifically, "the call is shape-valid AND the runtime state would normally accept it, BUT the current mode rejects it" (e.g. `set_demo_wallet` is shape-valid + runtime-permitted, but production mode rejects it).

**Pattern to lock:**
- `WRONG_MODE` is its own concept; not reusable as `INVALID_INPUT` (which is about arg shape) or `WRONG_STATUS` (which is about state machine).
- `set_demo_wallet` in production mode emits `WRONG_MODE`; `pair_ledger_live` in demo mode emits `DEMO_MODE_REFUSED` (note: these are DIFFERENT codes for SYMMETRIC failure modes — `DEMO_MODE_REFUSED` is the Phase 3 precedent for "this tool refuses in demo"; `WRONG_MODE` is the Phase 5 precedent for "this tool refuses outside demo"). Both are valid; both will be exhaustively switched on in v1.3 SEC-32 skill invariants.
- The ErrorCode union expansion is a TYPE-LEVEL BREAKING CHANGE — every exhaustive `switch` on `ErrorCode` downstream must add the case. This is the anti-foot-gun the comment at `error-codes.ts:4-6` documents. Planner accepts this — the alternative (reusing `INVALID_INPUT`) muddies the type at every consumer.

## Phase 4 Test Surface Changes (LOAD-BEARING)

**This section is the load-bearing flag for the planner.** Phase 5 Plan 05-02 modifies `prepare_native_send.ts` and `preview_send.ts` to NOT refuse in demo mode (Q-CONTRADICTION-PREP Option B locked). Two Phase 4 test files currently assert the OLD behavior; Plan 05-02 MUST REPLACE these assertions, NOT just delete them. Shipping Plan 05-02 with the old assertions still in place would either (a) fail the test suite, or (b) produce green-tests that lie about the new behavior — depending on the test's mock fixtures.

### Test 1: `test/prepare-native-send.test.ts:107-128` — REPLACE

**Current assertion** (line 108-127):

```typescript
it("refuses with DEMO_MODE_REFUSED when VAULTPILOT_DEMO=true; getStatus + createHandle NEVER called", async () => {
  process.env[DEMO_KEY] = "true";
  const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });
  expect(result.isError).toBe(true);
  expect((result.structuredContent as { errorCode: string }).errorCode).toBe("DEMO_MODE_REFUSED");
  // ... asserts ZERO getStatus + ZERO createHandle calls ...
});
```

**Replace with** (Plan 05-02 contract):

```typescript
it("succeeds in demo mode using active persona address as `from`; createHandle CALLED with persona", async () => {
  process.env[DEMO_KEY] = "true";
  setActivePersona("whale");  // import from "../src/demo/state.js"
  const result = await callTool({ to: FIXTURE_A.to, valueWei: FIXTURE_A.valueWei });
  expect(result.isError).toBeFalsy();
  // assert structuredContent shape — same as production happy path
  expect((result.structuredContent as { handle: string }).handle).toMatch(/^[0-9a-f-]+$/);
  // PAIR INVERSION: getStatus is NOT called in demo mode (persona is the from)
  expect(getStatusSpy).toHaveBeenCalledTimes(0);
  // createHandle IS called with the persona-derived tx
  expect(createHandleSpy).toHaveBeenCalledTimes(1);
});
```

**Why both changes are mandatory:** the old test asserts `getStatusSpy.toHaveBeenCalledTimes(0)` AND `createHandleSpy.toHaveBeenCalledTimes(0)`. In the new world, `getStatus` STILL has 0 calls (demo doesn't pair) BUT `createHandle` has 1 call (the demo flow creates real handles for the simulation). Deleting only the errorCode assertion leaves an inconsistent test that fails on the createHandle count.

### Test 2: `test/preview-send.test.ts:553-575` — REPLACE

**Current assertion** (line 555-574):

```typescript
it("VAULTPILOT_DEMO=true → DEMO_MODE_REFUSED; ZERO calls to lookup/getStatus/viem/4byte", async () => {
  const handle = seedHandle();
  process.env[DEMO_KEY] = "true";
  const result = await callTool({ handle });
  expect(result.isError).toBe(true);
  expect((result.structuredContent as { errorCode: string }).errorCode).toBe("DEMO_MODE_REFUSED");
  // ... asserts ZERO viem reads, ZERO 4byte call ...
});
```

**Replace with**:

```typescript
it("succeeds in demo mode using active persona as senderAddress; viem reads fire with persona address", async () => {
  const handle = seedHandle();
  process.env[DEMO_KEY] = "true";
  setActivePersona("whale");
  // Script viem reads — the demo flow STILL hits real RPC for accurate pin
  getTransactionCountSpy.mockResolvedValueOnce(7);
  estimateFeesPerGasSpy.mockResolvedValueOnce({ maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n });
  estimateGasSpy.mockResolvedValueOnce(21_000n);
  lookupSelectorSpy.mockResolvedValueOnce({ kind: "not-applicable" });
  const result = await callTool({ handle });
  expect(result.isError).toBeFalsy();
  // Assert viem fan-out reads fired WITH the persona's address
  expect(getTransactionCountSpy).toHaveBeenCalledWith(expect.anything(), { address: WHALE_ADDRESS, blockTag: "pending" });
});
```

### Test 3: `test/get-tx-verification.test.ts:281-294` — KEEP AS-IS

The `get_tx_verification` demo refusal STAYS — this tool re-emits handle state to a context-evicted agent; demo mode has no handle state worth re-emitting (the demo "wallet" doesn't own real keys). The existing assertion is correct under Plan 05-02 (Option B doesn't reshape this tool's contract).

### Test 4: `test/pair-ledger-live.test.ts:187-227` — KEEP AS-IS

`pair_ledger_live` demo refusal STAYS — demo mode never pairs a real Ledger. The strict-literal regression at line 207 (`VAULTPILOT_DEMO='True'` does NOT trigger refusal) is a load-bearing anchor; Plan 05-01 MUST keep this passing under the new resolution chain (research § Pitfall 6).

**Verification command:** `npm test -- prepare-native-send preview-send get-tx-verification pair-ledger-live` should run all 4 test files green AFTER Plan 05-02 lands (REPLACED Test 1 + 2; UNCHANGED Test 3 + 4).

## Metadata

**Analog search scope:**
- `src/chains/` (lazy-singleton precedent — `ethereum.ts`)
- `src/clients/` (HTTP fetch + AbortController — `fourbyte.ts`)
- `src/config/` (env accessors + existing `isDemoMode` body)
- `src/demo/` (NEW directory — no analogs to load)
- `src/diagnostics/` (logger + check-doctor config-file read)
- `src/signing/` (error-codes union shape for extension; handle-store for module-state pattern)
- `src/tools/` (4 tool-handler precedents: `pair_ledger_live`, `get_ledger_status`, `prepare_native_send`, `send_transaction`)
- `src/wallet/` (`session-manager.ts` module-state pattern)
- `src/server.ts` (dispatcher pattern)
- `test/` (env-toggle pattern, fixture-anchored test pattern, integration-test composition pattern)
- `test/helpers/` (factory shape — `mock-public-client.ts` is the precedent)

**Files scanned:** 14 source files (full read) + 6 test files (full or targeted read) + 2 planning docs (research + Phase 4 patterns) + CLAUDE.md.

**Confidence:**
- Tool / config / test patterns: HIGH — direct mirror of established Phase 2 + Phase 3 + Phase 4 conventions; multiple analogs converged on the same shape.
- Filesystem-config-read at boot: HIGH — `src/diagnostics/check.ts:96-124` is the verbatim shape to mirror; only the failure-mode behavior diverges (strict refuse-to-boot vs warn).
- Module-scoped mutable single-value state: HIGH — `src/wallet/session-manager.ts:108-110` pattern adapts trivially to single-field.
- Inferred-state diagnostic envelope: MEDIUM — no codebase precedent, but the structured shape mirrors `get_ledger_status` exactly; the "inferred" labels are descriptive convention only.
- Fire-and-forget background fetch: HIGH — research § Code Example supplies the verbatim shape; `globalThis.fetch` + `AbortSignal.timeout` verified at host Node v22.19.0.
- Dispatcher-wrap for response middleware: HIGH — Phase 4 set the precedent at the same file + same handler; one-arm extension.
- `WRONG_MODE` errorCode extension: HIGH — the union's organization is documented inline at `error-codes.ts:4-6`; the breaking-change-as-anti-foot-gun convention is explicit.
- Phase 4 test surface changes: HIGH — exact line numbers verified by grep; the REPLACE-vs-DELETE distinction is locked-in by the createHandleSpy count assertion that the existing tests rely on.

**Pattern extraction date:** 2026-05-12

## PATTERN MAPPING COMPLETE
