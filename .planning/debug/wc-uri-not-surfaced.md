---
status: resolved
trigger: pair_ledger_live never surfaces the WalletConnect URI to the agent — circular deadlock blocks real-Ledger pairing
created: 2026-05-12T14:22:10Z
updated: 2026-05-12T15:37:00Z
---

# Debug Session: wc-uri-not-surfaced

## Trigger

<DATA_START>
pair_ledger_live never surfaces the WalletConnect URI to the agent. The tool calls `client.connect()` which returns `{ uri, approval }`, but then awaits `approval()` for up to 60s before returning anything. The `wcUri` only lands in the response after approval succeeds — but approval can't succeed without the user pasting the URI into Ledger Live first. Circular deadlock. Reproduced just now: called `pair_ledger_live`, got `APPROVAL_TIMEOUT` after 60s, no URI ever reached chat or any reachable log. Stderr from the MCP isn't captured to `~/Library/Logs/Claude/main.log`. Source: `src/tools/pair_ledger_live.ts:106` awaits `pair()` which is `src/wallet/session-manager.ts:131-205` where line 196 returns `wcUri` only after the approval race resolves.
</DATA_END>

## Symptoms

- **Expected behavior:** Calling `pair_ledger_live` should surface the WC pairing URI (`wc:...`) to the agent so the user can paste it into Ledger Live → Settings → WalletConnect → Connect. The tool then waits for on-device approval and returns the paired status + VERIFY-ON-DEVICE block.
- **Actual behavior:** Tool blocks for 60s, returns `APPROVAL_TIMEOUT` error with no URI ever surfaced. The URI lives only in the unresolved `approval()` closure inside `pair()`.
- **Error messages:** `error: Ledger Live did not approve the pairing within 60 seconds; re-call pair_ledger_live to retry` (`errorCode: APPROVAL_TIMEOUT`)
- **Timeline:** Never worked. The bug has been latent since Phase 3 shipped `pair_ledger_live`. It was not caught because no real-Ledger pairing has been executed against the shipped code — the combined Phase 3+4+5 verify-phase (the v1.0 ship-gate) is still pending and would have caught this on first attempt.
- **Reproduction:**
  1. Register MCP with `VAULTPILOT_DEMO=false`, valid `WALLETCONNECT_PROJECT_ID`, valid `ETHEREUM_RPC_URL`.
  2. Restart Claude Code.
  3. Verify `get_vaultpilot_config_status` → `demoMode: false`, both `*Present: true`.
  4. Call `mcp__vaultpilot-gsd-mcp__pair_ledger_live` with no args.
  5. Observe: 60s wait, then `APPROVAL_TIMEOUT` with no URI.

## Reproduction Status

Reproduced ✓ (live in current session, just before invoking `/gsd-debug`).

## Source Pointers

- `src/tools/pair_ledger_live.ts:106` — `const result = await pair({ force });` — awaits the full approval race before doing anything with the URI.
- `src/wallet/session-manager.ts:165-197` — `pair()` calls `client.connect()` (gets `uri` + `approval`), then awaits `Promise.race([approval(), timeoutPromise])`, only returning `{ wcUri: uri, status }` after the race resolves.
- `src/wallet/session-manager.ts:196` — `return { wcUri: uri, status };` happens INSIDE the `await` chain, not as an early-emit.
- `src/diagnostics/logger.ts:3-5` — writes to `process.stderr`; this stderr stream is NOT captured by Claude Code's MCP log on this install (verified: no `wc:` or `vaultpilot` entries in `~/Library/Logs/Claude/main.log`).
- `test/pair-ledger-live.test.ts` — existing tests assert the locked-five errorCode set; will need updates for any handler split.

## Hypothesis (initial)

The `pair_ledger_live` tool's single-call shape is architecturally incompatible with the WC v2 connect/approval protocol. The protocol exposes `uri` immediately but `approval()` is long-lived; squeezing both into one MCP tool call traps the URI inside an awaited closure. Fix shape (per CLAUDE.md "System-Rejection Reframing" and "Best-Architectural-Solution Discipline"): split the tool into two phases.

Proposed split (Option A from the user-facing menu):

- **`pair_ledger_live_start`** — calls `client.connect()`, surfaces `wcUri` immediately, parks the `approval` promise in module-scoped state keyed by a returned pairing handle.
- **`pair_ledger_live_wait`** — given the handle, awaits the parked approval (with the 60s budget or a configurable timeout), returns `LedgerStatus` + VERIFY-ON-DEVICE block.
- Keep `pair_ledger_live` (single-shot) as a thin convenience wrapper that calls start, emits URI via stderr (best-effort), then waits — for tests/CI where the URI doesn't need surfacing.

Alternative shapes considered:
- MCP notifications mid-call: depends on Claude Code rendering server-initiated `notifications/message`; not currently observed to surface in chat.
- File-based URI emission: writes to `~/.vaultpilot-mcp/last-wc-uri.txt`; hacky, requires polling, fights the wire contract.

## Current Focus

```yaml
hypothesis: CONFIRMED — pair_ledger_live's single-call shape traps wcUri inside the awaited approval() closure; the WC v2 protocol's connect/approval split needs a corresponding two-tool split on the MCP surface
status: FIXED on branch fix/wc-uri-not-surfaced
```

## Evidence

- timestamp: 2026-05-12T14:18Z — Live repro: `pair_ledger_live({})` called via MCP, returned `APPROVAL_TIMEOUT` after 60s with no `wcUri` in response payload.
- timestamp: 2026-05-12T14:19Z — Source trace: `src/tools/pair_ledger_live.ts:106-115` confirms `wcUri` is only destructured AFTER `await pair({ force })` resolves.
- timestamp: 2026-05-12T14:19Z — Source trace: `src/wallet/session-manager.ts:166-197` confirms `uri` is captured from `client.connect()` BEFORE the approval race, but never emitted to caller until the race resolves.
- timestamp: 2026-05-12T14:20Z — Log check: `grep "vaultpilot\\|wc:" ~/Library/Logs/Claude/main.log` returned zero matches. MCP stderr from `process.stderr.write` is not reaching the Claude Code log on this install.
- timestamp: 2026-05-12T15:37Z — Fix implemented + 286 tests passing on branch fix/wc-uri-not-surfaced. TypeScript compiles clean.

## Eliminated

- ~~Hypothesis: config not picked up after restart~~ — eliminated: `get_vaultpilot_config_status` post-restart shows `demoMode: false`, both `*Present: true`.
- ~~Hypothesis: WC project ID invalid / relay unreachable~~ — eliminated: error path is `APPROVAL_TIMEOUT`, not `MissingProjectIdError` or relay-unreachable. The `connect()` call succeeded (the relay round-trip completed and an approval promise was created); only the user-side approval failed (because the user never saw the URI).

## Resolution

```yaml
root_cause: >
  pair_ledger_live's single-call shape is structurally incompatible with WC v2's
  connect/approval protocol. client.connect() returns { uri, approval } where uri is
  immediately available but approval() is a long-lived Promise. The tool awaited the
  full approval race (up to 60s) before returning anything, trapping the URI inside
  the closure. The user can never paste the URI into Ledger Live because they never
  see it — circular deadlock.

fix: >
  Two-phase split: pairStart() calls client.connect(), returns { wcUri, pairingHandle }
  immediately. The approval Promise is parked in a module-scoped Map keyed by handle.
  pairWait(handle) retrieves and races the parked promise against a 60s timeout.
  pair_ledger_live kept as a single-shot wrapper (useful for cached-session / CI use
  where URI surfacing is not needed). VERIFY_ON_DEVICE_TEMPLATE single source of truth
  preserved in pair_ledger_live.ts, imported by pair_ledger_live_wait.ts. All locked
  invariants preserved: locked-five errorCode set, PAIR-03 block, T-DEMO-1, T-PEND-1.

verification: >
  37 test files, 286 tests passing. TypeScript strict-mode clean. Live pairing against
  real Ledger still pending (requires user hardware — coordinate separately).

files_changed:
  - src/wallet/session-manager.ts (pairStart, pairWait, InvalidPairingHandleError, PairStartResult added)
  - src/tools/pair_ledger_live.ts (DESCRIPTION updated to route agents to two-phase flow)
  - src/tools/pair_ledger_live_start.ts (new)
  - src/tools/pair_ledger_live_wait.ts (new)
  - src/tools/register-all.ts (two new tool imports)
  - test/wallet-session-manager.test.ts (pairStart/pairWait test cases added)
  - test/pair-ledger-live-start.test.ts (new)
  - test/pair-ledger-live-wait.test.ts (new)
  - test/get-ledger-status.test.ts (smoke test updated to include new tools)
```
