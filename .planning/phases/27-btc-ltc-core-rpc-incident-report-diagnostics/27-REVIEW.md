---
phase: 27-btc-ltc-core-rpc-incident-report-diagnostics
reviewed: 2026-05-23T03:04:23Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/clients/bitcoin-core-rpc.ts
  - src/config/bitcoin-core-env.ts
  - src/tools/build_incident_report.ts
  - src/tools/get_btc_block_stats.ts
  - src/tools/get_btc_block_tip.ts
  - src/tools/get_btc_blocks_recent.ts
  - src/tools/get_btc_chain_tips.ts
  - src/tools/get_btc_mempool_summary.ts
  - src/tools/get_litecoin_block_tip.ts
  - src/tools/get_litecoin_mempool_summary.ts
  - src/tools/get_vaultpilot_config_status.ts
  - src/tools/register-all.ts
  - test/clients-bitcoin-core-rpc.test.ts
  - test/get-vaultpilot-config-status.test.ts
  - test/tools-build-incident-report.test.ts
  - test/tools-get-btc-block-stats.test.ts
  - test/tools-get-btc-block-tip.test.ts
  - test/tools-get-btc-blocks-recent.test.ts
  - test/tools-get-btc-chain-tips.test.ts
  - test/tools-get-btc-mempool-summary.test.ts
  - test/tools-get-litecoin-block-tip.test.ts
  - test/tools-get-litecoin-mempool-summary.test.ts
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 27: Code Review Report

**Reviewed:** 2026-05-23T03:04:23Z
**Depth:** standard
**Files Reviewed:** 21 (12 source + 9 test; `register-all.ts` counted once)
**Status:** issues_found

## Summary

Phase 27 adds a chain-agnostic Bitcoin Core / Litecoin Core JSON-RPC client, six forensic tools (BTC tip/stats/recent/chain-tips/mempool, LTC tip/mempool), one cross-chain anomaly aggregator (`build_incident_report`), and two booleans on `get_vaultpilot_config_status`. The security-critical invariants — NEVER-throws contract, no credential leakage into responses or logs, no `getrawmempool(verbose=true)` regression, no MCP stdout pollution — all hold under the standard-depth review. Zero `throw` statements in submitted source, `log()` writes only to stderr, all credential-leak scrub tests assert against unique sentinels.

No Critical findings. Five Warning-class findings are clustered around the per-chain timeout wrapper in `build_incident_report.ts` (the outer `AbortController` signal is not threaded into the inner `callBitcoinCoreRpc` calls — a resource leak on timeout but not a correctness break), a misleading test in `clients-bitcoin-core-rpc.test.ts` that stubs `fetch` twice and verifies only the synthetic-throw path (not the actual AbortController-driven abort), the lenient `body.error != null` gate that admits objects with non-numeric `code` into `rpc-error`, a `parseInt` that silently absorbs trailing garbage in Esplora plain-text responses, and a duplicated `runProbeWithTimeout`-style body across BTC and LTC probes that drifts on edits. Info items cover minor type/comment inconsistencies and dead imports.

## Warnings

### WR-01: Outer probe AbortSignal is not threaded into the inner RPC calls — fetches leak past 10s timeout

**File:** `src/tools/build_incident_report.ts:253-268`, `272`, `349`

**Issue:**
`runProbeWithTimeout` creates an `AbortController`, races the probe against a 10s timer, and passes `abort.signal` into `probe.run(abort.signal)`. The probe signatures accept `_signal: AbortSignal` (note the leading underscore) and never consume it — the parameter is unused in both `runBtcProbe` and `runLtcProbe`. The signal is *not* forwarded into `callBitcoinCoreRpc` (the client builds its own private `AbortController` internally and ignores any externally-supplied signal).

Effect: when the outer 10s timer fires, the probe-level `Promise.race` rejects with `timeout after 10000ms`, but the three already-in-flight `fetch()` calls inside `runBtcProbe` / `runLtcProbe` keep running for up to another full 10s on the client-internal timeout. On a slow node this doubles the worst-case latency of pending sockets — a resource leak under stress, not a correctness violation.

The contract comment at line 248-251 already acknowledges this: "individual callBitcoinCoreRpc calls can opt in if they wire a signal — but the race is the load-bearing mechanism." That is *aspirational* — no call site wires the signal, and the client does not accept one. Either remove the dead `_signal` parameter and update the comment, or thread an `AbortSignal` parameter through `callBitcoinCoreRpc` so the outer abort actually cancels the inner fetches.

**Fix:**
Either (a) remove the parameter to stop signalling intent that isn't honored:
```ts
async function runBtcProbe(): Promise<ProbeResult> { ... }
async function runLtcProbe(): Promise<ProbeResult> { ... }
// and in runProbeWithTimeout:
return await Promise.race<ProbeResult>([
  probe.run(),
  ...
]);
```
or (b) extend `callBitcoinCoreRpc` to accept an optional external `AbortSignal` and combine it with the internal one (`AbortSignal.any([external, internal])` on Node 20+) so the outer probe abort cascades into the in-flight fetches.

---

### WR-02: Test 8 in `clients-bitcoin-core-rpc.test.ts` stubs `fetch` twice and silently verifies only the synthetic-throw path — the AbortController-driven timeout is never actually exercised

**File:** `test/clients-bitcoin-core-rpc.test.ts:185-203`

**Issue:**
The test is titled "returns network-error with 'timeout' when AbortController fires", and the comment at line 186 says "Use a mock that fires the abort immediately after the signal is registered." Line 187-188 wires `makeAbortFetch()` (which would honor the controller's signal). Lines 191-194 then *override* that stub with `makeThrowFetch(abortErr)` (a fetch that synchronously rejects with a synthetic `AbortError`). Only the second stub is observed because `vi.stubGlobal` overwrites.

Net effect: the test verifies "if `fetch` itself throws an `AbortError`, the client classifies that as a timeout" — it never tests the actual code path where the client's own `setTimeout` → `controller.abort()` → `signal.aborted` → `fetch` rejects via AbortSignal. The first stub on line 188 is dead code.

This matters because the security-sensitive piece — the client's internal `BITCOIN_CORE_RPC_TIMEOUT_MS = 10_000` setTimeout → controller.abort() chain — is unverified. If a future refactor breaks `clearTimeout(timer)` in `finally` or the signal-to-fetch wiring, this test will still pass (because it short-circuits to the synthetic-throw branch).

**Fix:**
Drop the second stub and let the first one drive the abort end-to-end with `vi.useFakeTimers()` advancing past `BITCOIN_CORE_RPC_TIMEOUT_MS`:
```ts
it("returns network-error with 'timeout' when AbortController fires", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", makeAbortFetch());

  const promise = callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);
  await vi.advanceTimersByTimeAsync(BITCOIN_CORE_RPC_TIMEOUT_MS + 1);
  const result = await promise;

  expect(result.kind).toBe("network-error");
  if (result.kind === "network-error") expect(result.message).toMatch(/timeout/);
  vi.useRealTimers();
});
```

---

### WR-03: `body.error != null` gate accepts non-RPC error envelopes (e.g. `error: {}`) and silently coerces to code = -1 — masks malformed responses as RPC errors

**File:** `src/clients/bitcoin-core-rpc.ts:152-160`

**Issue:**
The 2xx-with-error branch is gated by `if (body.error != null)`. JSON-RPC 1.0 spec mandates `error` is either `null` or an object containing `code` (number) and `message` (string). The current code accepts *any* non-null value: `error: {}`, `error: "broken"`, `error: 42`, `error: true` — all coerce to `{kind: "rpc-error", code: -1, message: "unknown RPC error"}`.

This isn't a correctness vulnerability — the client doesn't throw and the agent gets a structured response — but it loses signal. A malformed upstream proxy that injects `error: "string"` looks identical to a legitimate Core RPC error with sentinel code -1. The agent has no way to distinguish "RPC method failed legitimately" from "the response shape is malformed." A more defensive read would route malformed envelopes to `network-error` (parse-level failure).

Lower-impact sibling: the HTTP-500 path at lines 126-138 has the same shape — if `body?.error` is `42` (a number), `typeof body.error.code === "number"` returns `false` (because reading `.code` on a primitive number gives `undefined`), so `rpcCode = resp.status` — but the *fact that the body was malformed* is silently swallowed.

**Fix:**
Tighten the gate to require object-shaped errors:
```ts
const errVal = body.error;
const isWellFormedError =
  errVal !== null &&
  typeof errVal === "object" &&
  !Array.isArray(errVal);

if (isWellFormedError) {
  const code = typeof (errVal as { code?: unknown }).code === "number"
    ? (errVal as { code: number }).code : -1;
  const message = typeof (errVal as { message?: unknown }).message === "string"
    ? (errVal as { message: string }).message : "unknown RPC error";
  result = { kind: "rpc-error", code, message };
} else if (errVal != null) {
  // Malformed JSON-RPC envelope — treat as a parse-level failure.
  result = { kind: "network-error", message: `Malformed JSON-RPC envelope: error field has unexpected type ${typeof errVal}` };
} else {
  result = { kind: "ok", result: body.result as T };
}
```

---

### WR-04: `parseInt` silently swallows trailing garbage in Esplora plain-text height responses

**File:** `src/tools/get_btc_block_tip.ts:88`, `src/tools/get_litecoin_block_tip.ts:101`

**Issue:**
The Esplora fallback parses the `/blocks/tip/height` plain-text body with `parseInt(heightText.trim(), 10)`. `parseInt` is permissive: `parseInt("850000<html>", 10)` returns `850000`, `parseInt("850000.5", 10)` returns `850000`, `parseInt("850000abc xyz", 10)` returns `850000`. Only a value that starts with non-digit characters becomes `NaN` (which the `isNaN(height)` check correctly catches).

A misbehaving upstream Esplora (e.g. returning an HTML 200 OK error page that starts with digits, or a JSON object serialized as text) can leak garbage past the integer-validation gate. Esplora is operator-configurable for both BTC (`BTC_ESPLORA_URL`) and LTC, so this is part of the operator-trust attack surface. The validation should reject anything that isn't strictly a non-negative integer string.

**Fix:**
Replace `parseInt` with a stricter check:
```ts
const trimmed = heightText.trim();
if (!/^\d+$/.test(trimmed)) {
  esploraError = `Esplora /blocks/tip/height returned non-integer: ${trimmed.slice(0, 20)}`;
} else {
  const height = Number(trimmed);
  // ...
}
```

Same fix in `get_litecoin_block_tip.ts:101`.

---

### WR-05: Three-way duplication of probe shape across `runBtcProbe` / `runLtcProbe` — drift surface on edits

**File:** `src/tools/build_incident_report.ts:272-345` (BTC), `349-416` (LTC)

**Issue:**
The two probes are line-for-line identical except for the chain literal (`"bitcoin"` vs `"litecoin"`), the env readers (`getBitcoinCoreRpcUrl` vs `getLitecoinCoreRpcUrl`), the mempool baseline constant (`BTC_MEMPOOL_BASELINE_TXS_DEFAULT` vs `LTC_MEMPOOL_BASELINE_TXS_DEFAULT`), and the target block-time constant. Approximately 70 lines duplicated.

Drift risk is concrete and security-relevant: if a future fix adds a new sub-probe (e.g. a `verifychain` health check) or changes the partial-success aggregation logic, the implementer can update one probe and not the other. Test coverage for partial-success (Test 8) only runs against BTC; LTC's partial-success branches are untested.

This is the kind of duplication where the "two-call-site abstraction tax" inverts into a maintenance hazard.

**Fix:**
Extract a single `runCoreProbe` parameterized on a `ChainProbeConfig` record:
```ts
interface ChainProbeConfig {
  chain: SupportedChain;
  getUrl: () => string | null;
  getUser: () => string | undefined;
  getPass: () => string | undefined;
  mempoolBaselineTxs: number;
  targetBlockTimeSecs: number;
}

const BTC_CONFIG: ChainProbeConfig = {
  chain: "bitcoin",
  getUrl: getBitcoinCoreRpcUrl,
  getUser: getBitcoinCoreRpcUser,
  getPass: getBitcoinCoreRpcPass,
  mempoolBaselineTxs: BTC_MEMPOOL_BASELINE_TXS_DEFAULT,
  targetBlockTimeSecs: BTC_TARGET_BLOCK_TIME_SECS,
};
// LTC_CONFIG analogous.

async function runCoreProbe(cfg: ChainProbeConfig): Promise<ProbeResult> {
  const url = cfg.getUrl();
  if (url === null) return { status: "core-not-configured", anomalies: [] };
  // ... single body, with cfg.chain / cfg.mempoolBaselineTxs / cfg.targetBlockTimeSecs substituted
}
```

Note: this is a routine refactor inside the same file — not a cross-cutting redesign — and the existing tests give it good coverage.

## Info

### IN-01: `BitcoinCoreRpcResult` JSDoc claims `network-error` covers "JSON parse error" but the early-return path at line 149 bypasses the unified `finally`

**File:** `src/clients/bitcoin-core-rpc.ts:51`, `147-150`

**Issue:**
The discriminated-union doc string at line 51 says `network-error` covers "AbortError timeout, fetch throws, or JSON parse error" — accurate. The 2xx-body parse-error branch on line 147-150 returns directly with the JSON-parse `network-error`, with an explicit comment "early exit before finally; clearTimeout in finally still runs." That's correct (JS `finally` runs on every exit path including `return`), but the early return introduces a second return statement in an otherwise single-exit function. Stylistic — assign `result` and fall through:
```ts
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  result = { kind: "network-error", message: `JSON parse error: ${msg}` };
  log("warn", `Bitcoin Core RPC JSON parse failed: method=${method} err=${msg}`);
  break;  // or restructure as nested if/else so control falls through to finally
}
```
Then the function has exactly one `return result` after the `try/catch/finally`. Reduces audit surface for future contributors.

**Fix:** Restructure so the function has a single trailing `return result;`.

---

### IN-02: `BitcoinCoreRpcResult` union docs name 5 arms; one (`rate-limited` 429) is undocumented in client-callers' error-code maps

**File:** `src/tools/get_btc_blocks_recent.ts:181-184` (and 5 sibling tool files)

**Issue:**
The `BitcoinCoreRpcResult` union includes `rate-limited`, but every consumer tool maps it to a `BITCOIN_CORE_RATE_LIMITED` / `LITECOIN_CORE_RATE_LIMITED` errorCode through the same ternary chain. Bitcoin Core in default config doesn't emit HTTP 429 — the comment at line 50 says "Bitcoin Core may return this with a proxy." The error-code identifier is fine; the only concern is that the docstring at line 50 should make this proxy-only path more explicit, since otherwise a future contributor might wonder when this arm fires.

**Fix:** Tighten the comment on line 50 to "HTTP 429 (rate limit; *only* observed when a reverse proxy sits in front of Core, never from Core itself in default config)."

---

### IN-03: `segwitAdoptionPct` JSDoc-equivalent comment says "rounded to 1 decimal" but integer result is what's stored — test expectations are correct, comment is misleading

**File:** `src/tools/get_btc_block_stats.ts:159-164`, `src/tools/get_btc_blocks_recent.ts:240-241`

**Issue:**
The expression `Math.round((stats.swtxs / stats.txs) * 1000) / 10` produces a JavaScript `number` that can be a non-integer (e.g. 87.5 for 1750/2000) or an integer (90 for 1800/2000). The test asserts `expect(sc.segwitAdoptionPct).toBe(90)` for 1800/2000 — passes because `90.0 === 90` in JS. Comment says "rounded to 1 decimal" but the structured surface displays as `segwitAdoptionPct: 90` (no decimal point in JSON for an integer-valued float). Functional correctness intact; comment is misleading.

**Fix:** Update comment to "Rounded to 0.1% precision; surfaced as a JS number (e.g. 87.5 or 90)."

---

### IN-04: `register-all.ts` import order: BTC block-tip imports listed before BTC status (line 32-39 then 40), but status is older Phase 22; cosmetic but readable

**File:** `src/tools/register-all.ts:32-40`

**Issue:**
Phase 27 imports (lines 32-39) are inserted between Phase 26 LTC reads (lines 29-31) and the Phase 22 `get_btc_status` (line 40). Chronological order would put `get_btc_status` after `get_btc_fee_estimates` (line 28). Side-effect imports are order-independent at runtime (each tool calls `registerTool` on import), so this is cosmetic only.

**Fix:** Reorder so Phase 22 tools group together before Phase 27 tools, if a follow-up phase touches this file.

---

### IN-05: `_signal` parameter in `runBtcProbe` / `runLtcProbe` carries a leading underscore convention but is also misleading documentation — it implies "the parameter is intentionally unused for now"

**File:** `src/tools/build_incident_report.ts:272`, `349`

**Issue:**
Companion finding to WR-01. The TypeScript convention `_signal` (leading underscore) signals "intentionally unused" — but the comment at line 249-251 implies the signal *should* be threaded into the calls eventually. Either thread it (per WR-01) or remove it; the current state of "named, typed, unused, but documented as load-bearing" is contradictory.

**Fix:** Once WR-01 is resolved (either path), this self-resolves.

---

### IN-06: `tipsRes.kind !== "not-configured"` branches in `runBtcProbe` are unreachable — the `url === null` short-circuit at line 274 means `callBitcoinCoreRpc` is never called with a null URL inside the probe

**File:** `src/tools/build_incident_report.ts:299`, `320`, `336` (BTC) and `372`, `392`, `407` (LTC)

**Issue:**
Each non-ok arm has the shape `} else if (infoRes.kind !== "not-configured") { ... }`. But the only way `callBitcoinCoreRpc` returns `not-configured` is when its first argument `url` is `null` (line 92 of the client). The probe already short-circuits on `url === null` at line 274 (`return { status: "core-not-configured", anomalies: [] }`), so by the time the three `callBitcoinCoreRpc` calls run, `url` is a non-null string. The `kind !== "not-configured"` guard is defensive dead code — not a bug, but it raises the question "when is this null path reachable?" which is documented nowhere.

**Fix:** Either drop the guard:
```ts
} else {
  anomalies.push({ type: "probe-failed", chain: "bitcoin", reason: `getblockchaininfo: ${rpcMessage(infoRes)}` });
}
```
or add a one-line comment "// Defensive: callBitcoinCoreRpc never returns not-configured when url is non-null, but the guard keeps the type-narrowing tidy."

---

_Reviewed: 2026-05-23T03:04:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
