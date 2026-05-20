---
status: resolved
trigger: WalletConnect session not surviving MCP restart — two findings (latent UX bug + possible real persist-write bug)
created: 2026-05-20T06:15:00Z
updated: 2026-05-20T06:35:00Z
---

# Debug Session: wc-session-persist-restart

## Trigger

<DATA_START>
User reported: "wallet connect session should survive the mcp restart, but it seems that it was deleted". User paired Ledger Live successfully today (2026-05-20 morning), then restarted Claude Code / the MCP, and now `get_vaultpilot_config_status` reports `pairedAccountCount: 0`. The `walletConnectStoragePersistent` flag is `true`. Two latent issues found during orchestrator triage:

(1) **Confirmed latent UX bug**: `getStatus()` in `src/wallet/session-manager.ts:602-609` short-circuits to `null` when `_isWalletConnectClientInitialized()` is `false`. On cold MCP boot, the SignClient singleton is lazily initialized — nothing has called `getWalletConnectClient()` yet, so any read tool (`get_vaultpilot_config_status`, `get_ledger_status`) reports "not paired" EVEN WHEN a session is persisted on disk. Only `pair_ledger_live` triggers SignClient init via `getWalletConnectClient()`, at which point persisted sessions load into memory. This converts the user-facing meaning of "persist" from "survives restart automatically" into "survives restart but you must call pair to find out."

(2) **Possible real persist-write bug to verify**: User paired today, restarted, and ONLY `~/.vaultpilot-mcp/wc-storage/wc@2/core/0.3/subscription` exists on disk (201 bytes, one relay topic). No `wc@2/client/0.3/session`, no `keychain`, no `pairing`, no `messages`. A fully-paired session writes 5-6 more files. Either WC SDK's `session_delete` fired from the Ledger side and SDK cleaned up everything except subscription, OR persist mode isn't actually durably writing the session record despite `storageOptions.database` being set to a real directory. The `subscription` file dates to the same `mkdir` time as the parent dir (2026-05-20 05:59), suggesting init wrote it but no later session-store write happened.
</DATA_END>

## Symptoms

- **Expected behavior:** After a successful Ledger Live pair under `VAULTPILOT_WC_STORAGE=persist` (the default), restarting the MCP should restore the paired session automatically. `get_ledger_status` and `get_vaultpilot_config_status` called as the FIRST tool after restart should report `paired: true` / `pairedAccountCount: 1` without an intervening `pair_ledger_live` call.
- **Actual behavior:** `get_vaultpilot_config_status` after restart reports `pairedAccountCount: 0` and `wcSessionTopicSuffix: null`, even though `walletConnectStoragePersistent: true`. Disk inspection shows no session record in `~/.vaultpilot-mcp/wc-storage/`.
- **Error messages:** None — silent zero-result. No exception, no stderr warning.
- **Timeline:** Per user: paired today (2026-05-20) before this Claude Code restart. PR #26 (`feat(wc): persist WalletConnect session across MCP restarts`, commit `02fb3b1`) shipped 2026-05-13 and added the persist mode. Bug (1) is latent since that PR — the lazy-init optimization was retained but the persist default changed; the combination makes (1) silently misleading. Bug (2) (if real) is also latent since PR #26.
- **Reproduction:**
  1. Register MCP with `VAULTPILOT_DEMO=false`, valid `WALLETCONNECT_PROJECT_ID`, valid `ETHEREUM_RPC_URL`.
  2. Restart Claude Code.
  3. Successfully `pair_ledger_live_start` → paste URI into Ledger Live → approve → `pair_ledger_live_wait` returns paired status.
  4. Verify `get_vaultpilot_config_status` shows `pairedAccountCount: 1`.
  5. Restart Claude Code (closes the MCP child process).
  6. Call `get_vaultpilot_config_status` FIRST (before any `pair_ledger_live*` call). Observe: `pairedAccountCount: 0`, `wcSessionTopicSuffix: null` — the persisted session is NOT surfaced. (This proves bug 1 regardless of whether bug 2 is real.)
  7. Inspect `~/.vaultpilot-mcp/wc-storage/wc@2/client/0.3/session` — if file does NOT exist, bug 2 is confirmed; if file DOES exist, bug 2 is fabricated and only bug 1 needs fixing.

## Reproduction Status

User's live state already shows the symptom: `pairedAccountCount: 0` with `walletConnectStoragePersistent: true` post-restart. Direct disk inspection at orchestrator triage confirms only `subscription` is on disk (no `session`). Bug 1 reproducible deterministically from any cold MCP boot. Bug 2 reproducibility requires a controlled fresh-pair-then-restart cycle — needs verification step in fix flow.

## Source Pointers

- `src/wallet/session-manager.ts:602-609` — `getStatus()` returns `null` synchronously when `_isWalletConnectClientInitialized()` is false. The intent (doc comment lines 597-601) is "no relay round-trip on unpaired status read"; the consequence is "persisted sessions invisible until pair triggered."
- `src/wallet/walletconnect-client.ts:60-126` — lazy-singleton `getWalletConnectClient()`. Init writes to disk via `storageOptions: { database }` (line 118). The init path is the only entry into SignClient construction.
- `src/wallet/walletconnect-client.ts:133-135` — `_isWalletConnectClientInitialized()` is the gate that `getStatus()` short-circuits on.
- `src/config/wc-storage.ts:75-77` — `getWalletConnectStoragePath()` returns `~/.vaultpilot-mcp/wc-storage` (a DIRECTORY for fs-lite driver).
- `src/config/wc-storage.ts:95-138` — `ensureStorageDirWithPerms` creates with `0o700` on absent; warn-only on perm drift; refuse-to-boot on ENOTDIR. Already running before SignClient init — directory IS being created. The question for bug 2 is whether SignClient is actually writing session records into it.
- `src/tools/get_vaultpilot_config_status.ts:132` — `pairedAccountCount = status === null ? 0 : 1` — derived from `getStatus()`; inherits the short-circuit.
- `src/server.ts` — entry point; `startServer()` is where eager `await getWalletConnectClient()` lands.
- PR #26 commit `02fb3b1` — added the persist mode. Tests in `test/config-wc-storage.test.ts` and `test/wallet-walletconnect-client.test.ts`.

## Disk Evidence (gathered at orchestrator triage)

```
~/.vaultpilot-mcp/                       drwx------  May 20 05:59 (0o700, correct)
~/.vaultpilot-mcp/wc-storage/            drwxr-xr-x  May 20 05:59 (0o755 — drift from 0o700; ensureStorageDirWithPerms warns only)
~/.vaultpilot-mcp/wc-storage/wc@2/core/0.3/subscription  -rw-r--r--  May 20 05:59  201 bytes
   content: [{"topic":"e693eace6b6c42567890e309a57667c7c392543bc44f308a9e15d002d5ed503c","relay":{"protocol":"irn"},"transportType":"relay","id":"fcb28cac5967a767f654647bd911fa5cf10d8086aa74452f5455d8069966b0dd"}]
```

Notable: subscription topic `e693eace...` exists but no `wc@2/client/0.3/session` file. Per WC v2 SDK semantics, a successful pair writes:
- `wc@2/core/0.3/keychain` (encryption keys)
- `wc@2/core/0.3/messages` (relay message history)
- `wc@2/core/0.3/pairing` (pairing records)
- `wc@2/core/0.3/subscription` (relay subscriptions — PRESENT)
- `wc@2/client/0.3/proposal` (proposal records)
- `wc@2/client/0.3/session` (session records — MISSING)

Subdir perm 0o755 vs expected 0o700: `ensureStorageDirWithPerms` calls `mkdirSync(path, { recursive: true, mode: 0o700 })` which should respect umask 0o022 → effective 0o700. But subdir shows 0o755. Either (a) SDK created subdirs under wc-storage itself with default mode, OR (b) ensureStorageDirWithPerms ran on already-existing 0o755 dir and only warned. Minor — does not affect data correctness, only access policy.

Current `umask` is `0o022` (standard).

## Hypothesis (initial)

**Bug 1 (UX/visibility — confirmed by source trace):** The lazy SignClient init combined with `getStatus()`'s init-gate short-circuit means persisted sessions are not visible until something calls `getWalletConnectClient()`. Fix: eager `await getWalletConnectClient()` at MCP server start (`src/server.ts` or `src/index.ts`), gated by:
- `getWalletConnectProjectId()` returning non-null (skip silently if no project ID — auto-demo + no-ledger users not affected)
- `getWalletConnectStorageMode() === "persist"` (no point eager-init when storage is `:memory:`)

After the fix: a status read on cold boot does NOT short-circuit; it correctly reflects on-disk state. The `getStatus()` short-circuit can either stay as defensive (now always falls through to `getWalletConnectClient()` which returns the already-init'd cached singleton instantly) or be removed.

**Bug 2 (persist correctness — needs verification):** Need to determine whether `client.session.set(...)` from `@walletconnect/sign-client` actually persists to the configured `database` directory, given the absence of `wc@2/client/0.3/session` on disk. Possibilities:
- (a) SDK writes work correctly, but user's prior session was deleted between pair and current state (e.g. session_delete fired from Ledger side — `disconnect` from Ledger Live → `session_delete` event → SDK clears session from store).
- (b) SDK writes work, but session was force-cleared by a code path calling `clearPersistedStorage()` — only `pair({ force: true })` and `pairStart({ force: true })` call it; user would have to have invoked re-pair.
- (c) SDK persist integration is broken — session records never durably write despite the storage mode.

Verification path: fresh-pair cycle with mid-flow disk inspection. If `wc@2/client/0.3/session` appears immediately after `pairWait` resolves with paired status, and survives a controlled MCP restart, the SDK integration is correct and (a) or (b) explains the user's loss. If the file never appears after a successful pair → (c) is the live bug and the fix scope expands.

## SDK Source-Read Findings (bug 2 plausibility check)

Read of `node_modules/@walletconnect/keyvaluestorage/dist/index.cjs.js` (Node loads CJS — package has no `exports` field; falls back to `main` per Node module resolution), `node_modules/unstorage/drivers/fs-lite.cjs`, and `node_modules/@walletconnect/core/dist/index.js`:

1. **CJS variant of keyvaluestorage uses `unstorage` + `fs-lite` driver.** ESM variant uses IndexedDB-only (browser-only), but Node correctly resolves to CJS via `main: dist/index.cjs.js`. Confirmed via `package.json` inspection.
2. **`fs-lite.cjs` setItem implementation is straightforward:** `setItem(key, value) { return writeFile(r(key), value, "utf8") }` where `r(key) = join(opts.base, key.replace(/:/g, "/"))`. Each WC key becomes a file under the configured base directory.
3. **`@walletconnect/core` Store class persists on every mutation:** `Store.prototype.persist` (one of several context-specialized variants) calls `this.setDataStore(this.values)` → `this.core.storage.setItem(this.storageKey, ...)` → fs-lite writeFile. The `persist()` method is invoked from `set`, `update`, `delete` — every state-changing operation.
4. **The SDK persistence path appears correctly wired.** Bug 2 is NOT plausibly an "SDK never persists" defect (option c above). A successful pair SHOULD result in a `wc@2/client/0.3/session` file with the session record JSON.
5. **The most likely explanation for the missing file** is option (a) or (b): a `session_delete` from Ledger Live (user disconnected via Ledger Live UI between pair and the symptom observation, OR Ledger Live's relay reconnect at the SDK side fired a stale session_delete) OR a force re-pair was invoked at some point that called `clearPersistedStorage()`. The `subscription` file's mtime matching the `mkdir` time (05:59, same as the current process boot) suggests the wc-storage dir was rebuilt on the current process boot — consistent with a `clearPersistedStorage()` in the prior process exit OR with the wc-storage dir not existing at the start of the prior process (first-ever pair under persist mode landing fresh).

**Verdict (bug 2):** Cannot be CONCLUSIVELY proven via SDK source-read alone — the source code SHOWS persistence should work, but the disk evidence shows the file is absent. Real-world verification requires a controlled fresh-pair-then-restart cycle with mid-flow filesystem snapshots. Per the orchestrator's briefing rule ("if implausible from source alone, ship bug-1 fix"), the SDK source-read suggests bug 2 is NOT a hot defect — it's most likely an explainable interaction with `session_delete` from the Ledger side or a prior force re-pair. **Recommendation: ship the bug-1 fix; surface bug 2 as a separate verification cycle requiring user-in-the-loop fresh-pair.**

## Current Focus

```yaml
status: RESOLVED — bug 1 fix applied; bug 2 inconclusive from source alone (deferred to user-verification cycle)
hypothesis_outcome:
  bug_1: CONFIRMED — getStatus() short-circuit + lazy-singleton interaction makes
    persisted sessions invisible to cold-boot status reads.
  bug_2: INCONCLUSIVE — SDK persistence path looks correctly wired in source;
    the missing wc@2/client/0.3/session file most likely reflects a prior
    session_delete or force-re-pair, NOT a broken SDK write path. Requires
    fresh-pair-then-restart verification to definitively rule out option (c).
fix_applied: |
  1. Added eagerInitWalletConnectIfPersist() in src/wallet/walletconnect-client.ts.
     - Skips silently when WALLETCONNECT_PROJECT_ID is unset (auto-demo / no-Ledger path).
     - Skips silently when storage mode is "memory" (no on-disk state to load).
     - Otherwise awaits getWalletConnectClient() — loads persisted sessions into the
       in-memory SignClient store at boot.
     - Catches and logs init failures (warn) — does NOT abort server startup.
  2. src/server.ts startServer() awaits eagerInitWalletConnectIfPersist() BEFORE
     server.connect(transport) — so the first tool dispatch sees the cached client.
  3. Added _env spy-affordance indirection in walletconnect-client.ts (canonical
     pattern per CLAUDE.md conventions).
regression_tests:
  - test/wallet-walletconnect-client.test.ts — new describe block, 5 unit tests:
    skip-arm-1 (no projectId), skip-arm-2 (memory mode), active (persist + projectId),
    robustness (init failure caught), idempotent (multi-call), env-indirection (spy).
  - test/wallet-session-manager.eager-init.test.ts — NEW FILE, 4 end-to-end tests:
    BUG REGRESSION (eager-init → getStatus returns paired), counterfactual (without
    eager-init the short-circuit fires even with session in store), memory-mode
    no-op preserves lazy behavior, no-projectId path is safe.
test_results: 1005 tests passing (up from 988; 9 new tests added).
typecheck: clean (tsc --noEmit).
bug_2_followup: surface as separate checkpoint — requires user to (a) clear
  ~/.vaultpilot-mcp/wc-storage, (b) pair Ledger Live, (c) snapshot disk, (d)
  restart MCP, (e) re-snapshot. If wc@2/client/0.3/session is present after
  step (c) and survives to step (e), bug 2 is confirmed not-a-bug; if absent
  after step (c), open a follow-up PR.
goal: find_and_fix
specialist_hint: typescript-expert (TS strict, ESM, vitest, viem + WC v2 SDK)
```

## Evidence

- timestamp: 2026-05-20T06:00Z — User reported expected-vs-actual via chat. `get_vaultpilot_config_status` returned `pairedAccountCount: 0`, `walletConnectStoragePersistent: true`, `wcSessionTopicSuffix: null` post-restart.
- timestamp: 2026-05-20T06:05Z — Direct disk inspection: `find ~/.vaultpilot-mcp/wc-storage -type f` returns only `wc@2/core/0.3/subscription` (201 bytes). No `client/0.3/session`, no `core/0.3/keychain`. Storage subdir perm 0o755 (drift from expected 0o700; ensureStorageDirWithPerms is warn-only on drift).
- timestamp: 2026-05-20T06:10Z — Source trace: `src/wallet/session-manager.ts:602-609` confirms `getStatus()` returns null synchronously when `_isWalletConnectClientInitialized()` is false. `src/wallet/walletconnect-client.ts:60-126` shows `getWalletConnectClient()` is lazy-init'd; only `pair*`, `disconnect`, and tool calls that invoke `await getWalletConnectClient()` trigger init. No code path at server start triggers init.
- timestamp: 2026-05-20T06:10Z — Source trace: `src/tools/get_vaultpilot_config_status.ts:132` `pairedAccountCount = status === null ? 0 : 1` inherits the short-circuit deterministically.
- timestamp: 2026-05-20T06:12Z — User confirmed via AskUserQuestion: "paired today, then restarted" — eliminates the 7-day TTL hypothesis for the user's specific case.
- timestamp: 2026-05-20T06:25Z — SDK source-read (keyvaluestorage CJS variant, fs-lite driver, @walletconnect/core Store class): persistence path is correctly wired. Bug 2 not plausibly a hot SDK defect. Verdict: ship bug-1 fix; bug 2 deferred to controlled fresh-pair verification.
- timestamp: 2026-05-20T06:30Z — Fix implemented: eagerInitWalletConnectIfPersist() in walletconnect-client.ts; startServer() awaits it; 9 new regression tests across 2 files.
- timestamp: 2026-05-20T06:33Z — Validation: 1005/1005 tests passing; typecheck clean.

## Eliminated

- ~~Hypothesis: 7-day WC session TTL expired~~ — eliminated: user confirmed pair happened today.
- ~~Hypothesis: persist mode wasn't actually active~~ — eliminated: `walletConnectStoragePersistent: true` and the wc-storage directory exists on disk with the subscription file.
- ~~Hypothesis: WALLETCONNECT_PROJECT_ID env var dropped between restart~~ — eliminated: `walletConnectProjectIdPresent: true` post-restart.
- ~~Hypothesis: SDK persistence integration broken (bug 2 option c)~~ — eliminated from source-read: keyvaluestorage CJS + fs-lite + Store.persist path is correctly wired; setItem calls writeFile per key. The disk-absence of `wc@2/client/0.3/session` more likely reflects a session_delete or force-re-pair clearing it.

## Resolution

**Root cause (bug 1):** `getStatus()` in `src/wallet/session-manager.ts` short-circuits to `null` when `_isWalletConnectClientInitialized()` is `false`. Combined with the lazy-singleton in `getWalletConnectClient()`, this means the first status read after a cold MCP boot returns "not paired" even when a session is persisted on disk — the SignClient hasn't been initialized yet, so it never loaded the persisted store into memory.

**Fix:** Added `eagerInitWalletConnectIfPersist()` in `src/wallet/walletconnect-client.ts`. `startServer()` awaits it BEFORE `server.connect(transport)`. The function:
- Skips silently when `WALLETCONNECT_PROJECT_ID` is unset (auto-demo or no-Ledger user — no eager init means no boot crash).
- Skips silently when storage mode is `"memory"` (nothing to load from disk).
- Otherwise calls `getWalletConnectClient()` — the lazy-init path that opens the SDK store and loads persisted sessions into memory.
- Catches and logs init failures (warn-level on stderr) — server startup MUST NOT abort when the WC backend is unreachable; demo + RPC reads still work.

**Why the existing `getStatus()` short-circuit stays:** the short-circuit's original intent (avoid a relay handshake on a pre-pair status read) is preserved — when no project ID is set, eager-init no-ops and the short-circuit correctly continues to return `null`. In production with persist + projectId, the gate flips at boot, and the short-circuit cleanly falls through to `findLiveSession(client)` against the now-loaded store. Both paths remain correct.

**Bug 2 outcome:** Deferred to user-verification. SDK source-read shows the persistence path is correctly wired; the most likely explanation for the missing `wc@2/client/0.3/session` file is a `session_delete` from Ledger Live or a prior force-re-pair, NOT a broken SDK write path. To definitively rule out a real persist-write defect, the user (or a follow-up PR) should: clear `~/.vaultpilot-mcp/wc-storage`, pair Ledger Live, snapshot the disk, restart the MCP, and re-snapshot. If the session file is present after the pair and absent after restart with no Ledger-side disconnect in between, that's a real bug for follow-up.

**Files changed:**
- `src/wallet/walletconnect-client.ts` — added `_env` indirection + `eagerInitWalletConnectIfPersist()`.
- `src/server.ts` — `startServer()` awaits eager-init before transport connect.
- `test/wallet-walletconnect-client.test.ts` — 5 new unit tests (eager-init contract).
- `test/wallet-session-manager.eager-init.test.ts` — NEW FILE, 4 end-to-end regression tests (bug-fix outcome anchor).

**Test results:** 1005/1005 passing; typecheck clean.

**User impact:** The user's CURRENT lost session is NOT restored by this fix (the on-disk state was missing the session record before the fix landed; the fix only ensures persisted sessions survive future restarts). User will need to re-pair Ledger Live once after upgrading; subsequent restarts will surface the paired session via the first status read without an intervening pair call.
