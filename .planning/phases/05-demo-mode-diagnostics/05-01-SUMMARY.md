---
phase: 05
plan: 01
slug: demo-state-and-personas
status: complete
completed: 2026-05-12
requirements: [DEMO-01, DEMO-02, DEMO-03, DEMO-04, INST-05]
---

# Phase 05 Plan 01 — Demo-mode resolution + persona registry + persona-management tools

## One-liner

Move `isDemoMode()` from a one-liner env check to an `env > config > auto-detect` resolution chain with strict-literal env validation; add a 4-entry curated persona registry, process-local active-persona state, two new MCP tools (`get_demo_wallet` / `set_demo_wallet`), and the 14th `ErrorCode` union member (`WRONG_MODE`).

## Files shipped

### New source files (8)

- `src/config/config-file.ts` — `getConfigPath()` + `ConfigFile` interface + `readConfigFile()`. Format-fanout-regex-sync sentinel — only place the `~/.vaultpilot-mcp/config.json` path literal lives. Exports `_paths` indirection so `vi.spyOn` intercepts internal calls (ESM binding workaround).
- `src/demo/personas.ts` — 4-entry `PERSONAS: ReadonlyArray<Persona>` with locked EIP-55-checksummed addresses (vitalik.eth, Circle USDC treasury, Binance 7, Binance 8). Module-load throws on bad checksum (T-PERSONA-ADDR-1).
- `src/demo/state.ts` — module-scoped `let activePersona: Persona | null`. Exports `getActivePersona` / `setActivePersona` / `_resetActivePersonaForTesting`. Setter throws on unknown slug (defense-in-depth behind the schema enum).
- `src/tools/get_demo_wallet.ts` — read-only tool, no `isDemoMode()` gate, lists 4 personas.
- `src/tools/set_demo_wallet.ts` — gated `WRONG_MODE` → `INVALID_INPUT` → activate flow. Schema enum locked to 4 slugs at the MCP boundary.
- `test/helpers/mock-config-file.ts` — Wave 0 helper. Uses `mkdtempSync` + `vi.spyOn(_paths, "getConfigPath")`. Sanity-checks the temp path is inside `/tmp` or `/var/folders`.
- `test/demo-resolution.test.ts` — 12 tests covering the full decision tree.
- `test/demo-state.test.ts` — 7 tests covering the persona registry + active-persona mutation.
- `test/get-demo-wallet.test.ts` — 3 tests (read shape, byte-identity, both modes).
- `test/set-demo-wallet.test.ts` — 7 tests including the load-bearing SDK-pipeline schema-enum gate (Test 4).

### Modified source files (4)

- `src/diagnostics/check.ts` — `checkConfigFile()` now imports `_paths.getConfigPath` + `readConfigFile` from `src/config/config-file.ts`. Three branches mapped 1:1; text output byte-identical (confirmed via `test/check-doctor.test.ts` staying green).
- `src/signing/error-codes.ts` — `ErrorCode` union grows to 14; `WRONG_MODE` added; producer-map comment block grows by one row naming Plan 05-01's `set_demo_wallet`.
- `src/config/env.ts` — `isDemoMode()` body replaced with the resolution chain (env > config > auto-detect). Added `isAutoDemo()`, `_resetDemoModeForTesting()`, `ResolutionResult` interface, lazy-singleton cache. Existing exports (`getEthereumRpcUrl` / `getRpcProvider` / `getRpcApiKey` / `getWalletConnectProjectId`) unchanged.
- `src/tools/register-all.ts` — exactly 2 added lines (`./get_demo_wallet.js` + `./set_demo_wallet.js`).

### Modified test files (5, beforeEach migration)

The new resolver caches on first call; existing tests that `delete process.env[VAULTPILOT_DEMO]` between cases would now fall through to the auto-demo arm (host-filesystem-dependent). Migration: every existing demo-aware test's `beforeEach` now (a) pins env to `"false"` and (b) calls `_resetDemoModeForTesting()` + `_resetActivePersonaForTesting()`. Tests that set env to `"true"` then call `isDemoMode()` add a `_resetDemoModeForTesting()` between to flush the cache.

- `test/pair-ledger-live.test.ts` — `beforeEach` migration + strict-literal regression test (line 207) rewritten to assert `process.exit(1)` per Q-STRICT.
- `test/prepare-native-send.test.ts` — `beforeEach` migration + cache reset before the DEMO_MODE_REFUSED test.
- `test/preview-send.test.ts` — same.
- `test/send-transaction.test.ts` — same; cache reset before the DEMO-05 simulation test.
- `test/get-tx-verification.test.ts` — same.
- `test/trust-pipeline.integration.test.ts` — `beforeEach` migration (no demo-mode case in this file; preserves auto-demo isolation).

## Test count

**225 passing (196 inherited + 29 new), 0 failing.** Suite runs in ~3.1s.

```
test/demo-resolution.test.ts        — 12 tests   (resolution decision tree + caching + auto-demo seed)
test/demo-state.test.ts             —  7 tests   (PERSONAS shape, byte-identity, mutation, reset)
test/get-demo-wallet.test.ts        —  3 tests   (4 entries, address byte-identity, both modes)
test/set-demo-wallet.test.ts        —  7 tests   (1=happy, 2=switch, 3=WRONG_MODE, 4=SDK-pipeline gate, 5=INVALID_INPUT, 6=TS-narrowing, 7=wiring)
```

## Key decisions

### Q-STRICT lock — invalid env values refuse to boot

```typescript
const envRaw = process.env.VAULTPILOT_DEMO;
if (envRaw !== undefined) {
  if (envRaw === "true") { cached = { mode: "env-on" }; return cached; }
  if (envRaw === "false") { cached = { mode: "env-off" }; return cached; }
  log(
    "error",
    `VAULTPILOT_DEMO must be literal "true" or "false"; got "${envRaw}". Refusing to boot.`,
  );
  process.exit(1);
}
```

Stderr text: `[error] VAULTPILOT_DEMO must be literal "true" or "false"; got "True". Refusing to boot.`

Phase 3 contract was "anything not literal `"true"` is treated as real-mode" (silent fallthrough). Phase 5 tightens this to "anything other than the two literals refuses to boot." Same SEMANTIC protection (capital-T is not demo); new MECHANISM (loud exit beats silent wrong-mode). T-DEMO-PREDICATE-1 mitigation.

### Q-AUTO-DEMO-PERSONA-DEFAULT lock — auto-demo seeds whale, guarded by `if null`

```typescript
cached = { mode: "auto-demo" };
if (getActivePersona() === null) {
  setActivePersona("whale");
}
```

The `if null` guard preserves test pre-seeds. A test that calls `setActivePersona("stable-saver")` before triggering auto-demo keeps stable-saver active (see `test/demo-resolution.test.ts` Test 12, T-AUTO-SEED-RACE-1).

### Q-CONFIG-NO-KEY lock — config without `demo` key resolves to real-mode

Source comment in `src/config/env.ts`:

```typescript
// Q-CONFIG-NO-KEY: file exists, no `demo` key → real-mode. The user
// configured something (likely `rpcUrl` for Phase 10's wizard) but
// didn't opt in to demo; respect that.
cached = { mode: "config-no-demo-key" };
```

### Q-WRONG-MODE lock — `ErrorCode` union grows to 14; `WRONG_MODE` added

Producer-map row in `src/signing/error-codes.ts`:

```
WRONG_MODE               — Plan 05-01 (set_demo_wallet called outside demo mode —
                           T-PERSONA-CONFUSION-1 mitigation; state NOT mutated.
                           Phase 5+ tools needing a similar mode check reuse the code
                           via `makeStructuredError`.)
```

### SDK-pipeline schema-enum gate methodology

`test/set-demo-wallet.test.ts` Test 4 mirrors `test/send-transaction.test.ts` Test 1a:
1. Install a `vi.fn` spy on `tool.handler` AFTER registration.
2. Spawn the server via `spawnServerInProcess()` (the actual `buildServer()` path).
3. Dispatch a `CallToolRequest` with `{ persona: "unknown-slug" }`.
4. Catch the thrown `McpError` and assert `code === -32602` OR message matches schema-violation shape.
5. Assert `handlerSpy.toHaveBeenCalledTimes(0)` — the protocol-level gate fires BEFORE the handler.

This proves the production `AjvJsonSchemaValidator` at `src/server.ts:55-66` is what rejects, not a standalone-ajv tautology test. Mirrors Plan 04-04 precedent.

### Format-fanout-regex-sync — `getConfigPath` is the single source of truth

```
$ grep -rn 'homedir(), ".vaultpilot-mcp"' src/
src/config/config-file.ts:55:  return join(homedir(), ".vaultpilot-mcp", "config.json");
```

Exactly 1 match. Prior to Plan 05-01, this literal was duplicated at `src/diagnostics/check.ts:96-124`; the refactor collapses both consumers (`env.ts::resolveDemoMode` + `check.ts::checkConfigFile`) onto `_paths.getConfigPath`.

ESM-binding note: `readConfigFile()` calls `_paths.getConfigPath()` (via the indirection object) so `vi.spyOn(_paths, "getConfigPath")` in tests intercepts internal calls. A direct `getConfigPath()` call would bind the reference at import-time and bypass the spy.

### Phase 3 strict-literal regression test migration

**Before** (`test/pair-ledger-live.test.ts:207-226`):

```typescript
it("DEMO-01 strict-literal predicate: VAULTPILOT_DEMO='True' (capitalized) does NOT trigger refusal", async () => {
  process.env[DEMO_KEY] = "True";
  // ... expect happy path ...
  expect(result.isError).toBeFalsy();
  expect(pairSpy).toHaveBeenCalledTimes(1);
});
```

**After**:

```typescript
it("VAULTPILOT_DEMO='True' (capital) refuses to boot per Q-STRICT (Phase 5)", () => {
  process.env[DEMO_KEY] = "True";
  _resetDemoModeForTesting();
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`mock-exit-${code ?? "undefined"}`);
  }) as never);
  expect(() => isDemoMode()).toThrow(/mock-exit-1/);
  expect(exitSpy).toHaveBeenCalledWith(1);
  exitSpy.mockRestore();
});
```

Same SEMANTIC protection ("capital T is not a demo signal"); new MECHANISM (silent fallthrough → boot refusal).

## Persona address verification

Addresses are locked at planning gate per `.planning/phases/05-demo-mode-diagnostics/05-RESEARCH.md` § Persona Picks. Verification ritual documented inline in `src/demo/personas.ts` head comment. Module-load test (`test/demo-state.test.ts` Tests 1-2) asserts EIP-55 byte-identity against the locked literals; if the executor swapped an address, this regression anchor fires.

R1 accepted residual (per plan): `defi-degen` (Binance 7) and `staking-maxi` (Binance 8) are archetype-mismatched (exchange hot wallets, not DeFi LPs / stETH-heavy EOAs). v1.0 ships these picks because no DeFi-aware read tool exercises the thematic fit yet. Phase 6 swaps in a one-line address change when ERC-20 enumeration tests would surface the mismatch.

## Deviations from PLAN

### D1 — `_paths` indirection in `config-file.ts` (Rule 3 — auto-fix blocking issue)

The plan instructed `vi.spyOn(configFileModule, "getConfigPath")` to redirect reads. In practice, ESM binding semantics mean an internal call from `readConfigFile()` to `getConfigPath()` resolves to the import-time binding and bypasses the module-level spy. The spy fires only for callers reaching through the namespace import.

Fix: added an `export const _paths = { getConfigPath }` indirection object in `src/config/config-file.ts`. `readConfigFile()` and `check.ts::checkConfigFile()` and `env.ts::resolveDemoMode` all route through `_paths.getConfigPath()`. The mock helper now does `vi.spyOn(_paths, "getConfigPath")` (instead of the module namespace). Identical security-fungible behavior; the indirection is a test-affordance, not a runtime cost.

Documented in `src/config/config-file.ts` JSDoc and `test/helpers/mock-config-file.ts` comment.

### D2 — register-all wiring smoke test rewritten (Rule 3 — auto-fix)

The plan instructed `_resetRegistryForTesting() + await import("../src/tools/register-all.js") + expect(getRegisteredTool("get_demo_wallet")).toBeDefined()`. ESM module cache prevents the side-effect imports from re-firing on re-import; after the registry reset, the second `await import` is a no-op and the registry stays empty.

Fix: Test 7 asserts the registry contents directly (after the top-of-file `await import("../src/tools/register-all.js")` triggered side-effect registration once). Same defensive intent — proves both demo tools are wired via the central register-all module.

### D3 — beforeEach migration in 5 existing test files (Rule 3 — auto-fix blocking issue)

The plan called out that `test/pair-ledger-live.test.ts:207` would need migration. In practice, all 6 existing demo-aware test files needed `beforeEach`/`afterEach` updates because the new resolver caches at first call AND defaults to auto-demo when env is unset AND no config file exists.

Fix: each migrated file's `beforeEach` now (a) pins `VAULTPILOT_DEMO=false` (instead of `delete`), (b) calls `_resetDemoModeForTesting()`, (c) calls `_resetActivePersonaForTesting()`. Tests that set env to `"true"` add a manual cache reset between the env set and the first call. Documented inline at each `beforeEach`.

## Threat-model assertions verified

- T-DEMO-PREDICATE-1 → `test/demo-resolution.test.ts` Tests 3-5 + migrated pair-ledger-live test
- T-CONFIG-MALFORMED-1 → `test/demo-resolution.test.ts` Test 10
- T-PERSONA-CONFUSION-1 → `test/set-demo-wallet.test.ts` Test 3
- T-NO-PERSIST-1 → `test/demo-state.test.ts` Test 6 (`_resetActivePersonaForTesting`)
- T-PERSONA-ADDR-1 → `test/demo-state.test.ts` Tests 1-2 (byte-identity to locked literals)
- T-AUTO-SEED-RACE-1 → `test/demo-resolution.test.ts` Test 12

## Self-Check: PASSED

All files exist:
- src/config/config-file.ts ✓
- src/demo/personas.ts ✓
- src/demo/state.ts ✓
- src/tools/get_demo_wallet.ts ✓
- src/tools/set_demo_wallet.ts ✓
- test/helpers/mock-config-file.ts ✓
- test/demo-resolution.test.ts ✓
- test/demo-state.test.ts ✓
- test/get-demo-wallet.test.ts ✓
- test/set-demo-wallet.test.ts ✓
- .planning/phases/05-demo-mode-diagnostics/05-01-SUMMARY.md ✓ (this file)

`npm test`: 225 passing, 0 failing.
`npm run typecheck`: clean.
`npm run build`: clean.
