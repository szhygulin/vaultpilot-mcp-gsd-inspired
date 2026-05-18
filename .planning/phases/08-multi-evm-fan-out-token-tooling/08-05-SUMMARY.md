---
phase: 08
plan: 05
subsystem: wallet — WalletConnect v2 multi-chain pairing + per-chain account scope
tags: [multi-chain, walletconnect, pairing, namespaces, accountsByChain, partiallyPaired, per-chain-active-account, t-wc-partial-1, t-session-topic-leak-1, phase-8, wave-4, success-criterion-8]
requirements: []
wave: 4
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "src/config/contracts.ts (Plan 08-01 — ChainId + ChainName + chainIdFromName)"
    - "src/config/env.ts (Plan 08-01 — env reader infrastructure; this plan adds getConfiguredChainIds)"
    - "src/wallet/session-manager.ts (Phase 3 — pair/pairStart/pairWait + LedgerStatus interface; this plan widens)"
    - "src/wallet/caip.ts (Phase 3 — parseEvmAccountId; reused unchanged)"
    - "src/tools/set_active_account.ts (Phase 5 quick-task wc-multi-account-session — single-arg setActiveAccount; this plan adds optional chain arg)"
  provides:
    - "Multi-chain WC pairing — REQUIRED_NAMESPACES.eip155.chains driven from getConfiguredChainIds() → for v1.2 = [eip155:1, eip155:42161, eip155:137, eip155:8453, eip155:10]"
    - "LedgerStatus.accountsByChain: Record<number, Address[]> — per-chain account map for downstream per-chain tools"
    - "LedgerStatus.activeChainId: number — currently-active chain; defaults to first configured chain present in session; back-compat alias chainId preserved"
    - "LedgerStatus.partiallyPaired: boolean — T-WC-PARTIAL-1 flag + one-shot stderr warning naming missing chains"
    - "set_active_account({ address, chain? }) per-chain scope — when chain arg provided, lookup restricted to status.accountsByChain[chainId]; cross-chain back-compat when omitted"
    - "getConfiguredChainIds(): readonly ChainId[] — single SOT for the v1.2-configured chain set; consumed by REQUIRED_NAMESPACES + future strict-mode filter"
  affects:
    - "src/config/env.ts (MODIFY — +1 export getConfiguredChainIds + 1 const CONFIGURED_CHAIN_IDS + ChainId type-only import)"
    - "src/wallet/session-manager.ts (MODIFY — 2 surgical edits + LedgerStatus widening + 2 new module-state maps + force-pair/disconnect/session_delete cleanup parity)"
    - "src/tools/set_active_account.ts (MODIFY — optional chain arg in schema + per-chain branch in handler + DESCRIPTION + getStatus import + CHAIN_ENUM constant)"
    - "test/session-manager.multi-chain.test.ts (NEW — 13 cases)"
    - "test/wallet-session-manager.test.ts (MODIFY — 3 toEqual shape updates for the +3 new LedgerStatus fields)"
    - "test/set-active-account.test.ts (MODIFY — +5 per-chain cases + getStatus spy wiring)"
    - "test/get-ledger-status.test.ts (MODIFY — +4 cases incl. T-SESSION-TOPIC-LEAK-1 3-sentinel scan)"
  unblocks:
    - "Phase 8 Success Criterion #8 (WC pairing proposal covers every configured chain; Ledger Live's account picker surfaces L2 accounts when networks enabled)"
    - "Phase 8 code-completion — this is the final execute plan in Phase 8; retrospective + close-out chore is next"
    - "v1.3+ set_active_chain tool — activeChainIdByTopic module-state slot already in place, public mutator deferred"
    - "v1.3+ vaultpilot-preflight skill — partiallyPaired flag surfaces over the wire for skill-side warning amplification"
tech-stack:
  added: []
  patterns:
    - "Multi-chain WC v2 requiredNamespaces.eip155.chains derived at module load from getConfiguredChainIds().map(id => `eip155:${id}`) — single SOT for the configured chain set"
    - "Per-topic state Maps (activeAccountByTopic, activeChainIdByTopic, warnedPartiallyPairedByTopic) all cleared in 4 sites: force-pair branches (×2), disconnect(), session_delete listener, _resetSessionManagerForTesting"
    - "One-shot stderr-warning latch (Set<topic>) for partial-pairing — fires once per pair-event; cleared on session_delete + force-pair + test reset so a re-pair on a fresh topic re-warns if still partial"
    - "Tool-layer per-chain validation BEFORE delegating to session-manager.setActiveAccount() — checksum-insensitive lookup against accountsByChain[chainId] surfaces INVALID_ACCOUNT with the per-chain set named in the refusal text (T-SET-ACTIVE-ACCOUNT-CHAIN-SCOPE-BYPASS-1 mitigation)"
    - "Address de-duplication in sessionToStatus via getAddress(a) checksum equality — handles split-derivation wallets where Ledger Live derives different paths per chain (rare but possible)"
    - "JSON-serialization-stable per-chain map: Map<number, Address[]> → Record<number, Address[]> — JS coerces numeric keys to strings on the wire; callers read `record[42161]` and JS handles the conversion implicitly"
    - "3-sentinel substring scan for secret-safety (T-SESSION-TOPIC-LEAK-1): assert sentinel topic does NOT appear in JSON.stringify(structuredContent) AND not in content[0].text AND only the last-8 substring may surface"
key-files:
  created:
    - "test/session-manager.multi-chain.test.ts (+496 lines, 13 cases — REQUIRED_NAMESPACES shape + full multi-chain session + T-WC-PARTIAL-1 anchor + once-per-topic warn latch + activeChainId default resolution + split-derivation accounts + no-accounts-on-configured-chains refusal + LedgerStatus 8-field shape + T-SESSION-TOPIC-LEAK-1 anchor + multi-account-on-one-chain regression)"
  modified:
    - "src/config/env.ts (+38 lines — type-only `ChainId` import + CONFIGURED_CHAIN_IDS constant + getConfiguredChainIds export with v1.2-permissive doc-comment)"
    - "src/wallet/session-manager.ts (+220 lines — 2 surgical edits + 3 new LedgerStatus fields + activeChainIdByTopic Map + warnedPartiallyPairedByTopic Set + multi-chain sessionToStatus body + per-topic cleanup in 4 sites)"
    - "src/tools/set_active_account.ts (+83 lines — CHAIN_ENUM constant + getStatus import + chainIdFromName import + chain enum in INPUT_SCHEMA + per-chain validation branch + DESCRIPTION update)"
    - "test/wallet-session-manager.test.ts (+14 lines — 3 toEqual updates to include the +3 new LedgerStatus fields; existing pair-flow + setActiveAccount tests stay byte-frozen)"
    - "test/set-active-account.test.ts (+160 lines — getStatusSpy mock wiring + 5 new per-chain cases: cross-scope bypass refusal, per-chain happy path, back-compat cross-chain, WALLET_NOT_PAIRED via per-chain branch, empty-chain refusal text)"
    - "test/get-ledger-status.test.ts (+142 lines — +4 cases: multi-chain envelope shape, full multi-chain partiallyPaired:false, partial-pairing partiallyPaired:true, T-SESSION-TOPIC-LEAK-1 3-sentinel scan)"
decisions:
  - "**getConfiguredChainIds() returns ALL 5 chains unconditionally for v1.2.** PublicNode fallback covers all 5 chains (per Plan 08-01); making the helper a one-line static return matches the plan's `truths` block verbatim. Future v1.3+ may filter to chains with EXPLICIT custom RPC if a `fail-fast on unconfigured chain` mode becomes desirable; for v1.2 the list is permissive."
  - "**Ethereum (chainId 1) always first.** Both REQUIRED_NAMESPACES.eip155.chains and the activeChainId resolution path (`configuredChainIds.find(id => map.has(id))`) treat chain order as load-bearing — Ethereum first means a fresh pair resolves to chainId=1 as the default activeChainId, matching v1.0/v1.1 behavior at the JSON wire level. Pinned in `test/session-manager.multi-chain.test.ts` Test 2 as the T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1 anchor."
  - "**LedgerStatus widening is back-compat at the JSON serialization level.** Existing 5 fields (`accounts`, `activeAccount`, `address`, `chainId`, `sessionTopicLast8`) preserved byte-for-byte; the 3 new fields (`accountsByChain`, `activeChainId`, `partiallyPaired`) are additive. Existing consumers (`pair_ledger_live` destructures `address`, `chainId`, `sessionTopicLast8`; `get_ledger_status` projects 5 legacy fields) see no behavior change. 3 toEqual-strict shape assertions in `test/wallet-session-manager.test.ts` widened to include the new fields — necessary tightening, not a semantic change."
  - "**Per-chain validation lives in the TOOL layer, not session-manager.setActiveAccount.** The tool's chain branch consults getStatus(), validates against `status.accountsByChain[chainId]`, then delegates to the existing single-arg `setActiveAccount(address)`. Rationale: the session-manager's existing AccountNotInSessionError surfaces a CROSS-chain list (Phase 5 quick-task back-compat); preserving that signature avoids breaking the 6 existing test cases in `test/wallet-session-manager.test.ts` while still enforcing per-chain scope at the dispatch boundary. The tool layer's refusal text explicitly names (a) the address, (b) the chain string, (c) the chainId, (d) the per-chain account set — full self-correction surface."
  - "**`chain` arg is OPTIONAL, not REQUIRED.** Plan body and PATTERNS.md both specify OPTIONAL; the prompt's `constraints[5]` paraphrase suggested REQUIRED with a deprecation default. The PLAN body is the canonical spec — making it required would break the Phase 5 quick-task `wc-multi-account-session` back-compat the plan explicitly preserves (`when chain is omitted, search across all chains via status.accounts`). Plan body wins."
  - "**Per-topic state cleared in 4 sites (consistency parity).** The existing `activeAccountByTopic` was cleared in: (a) force-pair `pair()` branch, (b) force-pair `pairStart()` branch, (c) `disconnect()`, (d) session_delete listener, (e) `_resetSessionManagerForTesting`. Plan 08-05 mirrors this 5-site pattern for the new `activeChainIdByTopic` Map + `warnedPartiallyPairedByTopic` Set. Skipping any one site would let a stale entry survive across a re-pair on the same topic — silent bug class."
  - "**No new errorCode introduced.** T-WC-PARTIAL-1 surfaces as a non-blocking informational `partiallyPaired: true` flag + stderr warning, NOT as a refusal. Cross-chain reads/prepares on missing chains will fail at their own RPC/signing layers with their own error envelopes (CHAIN_ID_MISMATCH from Plan 08-02, etc.) — defense-in-depth without a brand-new code in the locked-set."
  - "**Empty-chain refusal text load-bearing.** When the user calls `set_active_account({ chain: 'optimism' })` and the session doesn't cover Optimism, the refusal text says `(none — chain not covered by current session)` rather than just an empty list. The agent can route this to `pair_ledger_live({ force: true })` or surface the LL Manage Accounts hint."
metrics:
  duration: "~30 minutes (single execution wave; one rework on the warning chain-order assertion in Test 4 — caught by the first vitest run)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 1
  files_modified: 6
  files_deleted: 0
  tests_before: 767
  tests_after: 789
  tests_delta: 22
  loc_delta: "+1130 (+634 in modified files, +496 in new test file)"
---

# Phase 8 Plan 08-05: WalletConnect Multi-Chain Pairing + `accountsByChain` + `partiallyPaired` + `set_active_account` Per-Chain Scope Summary

Wave 4 of Phase 8 — the final execute plan in the phase. Closes Phase 8 Success Criterion #8 (WalletConnect pairing proposal covers every configured chain; Ledger Live's account picker surfaces L2 accounts when networks enabled in Manage Accounts). Two surgical edits in `src/wallet/session-manager.ts` + `LedgerStatus` interface widening + `set_active_account` per-chain scope. Cryptographic-binding chain BYTE-FROZEN. Pair-flow tools (`pair_ledger_live*`) BYTE-FROZEN — multi-chain support is automatic once `REQUIRED_NAMESPACES.eip155.chains` reflects the configured set.

## What Shipped

### 1. `getConfiguredChainIds()` helper (`src/config/env.ts`)

Single source of truth for the v1.2-configured chain set. Permissive: returns all 5 ChainIds unconditionally (PublicNode fallback covers all 5 per Plan 08-01).

```typescript
const CONFIGURED_CHAIN_IDS: readonly ChainId[] = [1, 42161, 137, 8453, 10];

export function getConfiguredChainIds(): readonly ChainId[] {
  return CONFIGURED_CHAIN_IDS;
}
```

Ethereum (chainId 1) is ALWAYS the first entry — both `REQUIRED_NAMESPACES.eip155.chains` and `sessionToStatus`'s `activeChainId` resolver treat order as load-bearing. v1.3+ may filter to chains with explicit RPC if a strict mode becomes desirable; v1.2 is permissive.

### 2. `REQUIRED_NAMESPACES.eip155.chains` driven from configured set (`src/wallet/session-manager.ts:67`)

Surgical Edit 1 — replaces the hardcoded `["eip155:1"]` literal:

```typescript
// BEFORE (Phase 3 — single-chain):
const REQUIRED_NAMESPACES = {
  eip155: { chains: ["eip155:1"], methods: [...], events: [...] },
};

// AFTER (Plan 08-05 — multi-chain):
const eip155Chains: string[] = getConfiguredChainIds().map((id) => `eip155:${id}`);
const REQUIRED_NAMESPACES = {
  eip155: { chains: eip155Chains, methods: [...], events: [...] },
};
// → chains = ["eip155:1", "eip155:42161", "eip155:137", "eip155:8453", "eip155:10"]
```

The WC v2 spec accepts a multi-chain `requiredNamespaces.eip155.chains` array; Ledger Live's account picker surfaces accounts for every chain the wallet has enabled in Manage Accounts.

### 3. Multi-chain accounting in `sessionToStatus` (`src/wallet/session-manager.ts:620-632`)

Surgical Edit 2 — REMOVES the multi-chain refusal (`"paired session has accounts on multiple eip155 chains... v1.x is mainnet-only"`). REPLACES with multi-chain accounting:

```typescript
// Group every CAIP-10 entry by chainId
const accountsByChainMap = new Map<number, Address[]>();
for (const entry of parsed) {
  const existing = accountsByChainMap.get(entry.chainId) ?? [];
  if (!existing.some((a) => getAddress(a) === getAddress(entry.address))) {
    existing.push(entry.address);
  }
  accountsByChainMap.set(entry.chainId, existing);
}

// Resolve activeChainId: first configured chain present in session
// (research § Topic 8 line 717 — "first configured chain")
const configuredChainIds = getConfiguredChainIds();
const candidateChainId = configuredChainIds.find((id) => accountsByChainMap.has(id));
if (candidateChainId === undefined) {
  throw new Error(
    `paired session has no accounts on any configured chain (${configuredChainIds.join(",")}); ...`,
  );
}
const activeChainId = activeChainIdByTopic.get(session.topic) ?? candidateChainId;

// T-WC-PARTIAL-1 detection + once-per-topic stderr warning
const partiallyPaired = configuredChainIds.some((id) => !accountsByChainMap.has(id));
if (partiallyPaired && !warnedPartiallyPairedByTopic.has(session.topic)) {
  const approved = configuredChainIds.filter((id) => accountsByChainMap.has(id));
  const missing = configuredChainIds.filter((id) => !accountsByChainMap.has(id));
  log("warn", `⚠ Paired session covers chains [${approved.join(",")}] but configured chains include [${missing.join(",")}]; ...`);
  warnedPartiallyPairedByTopic.add(session.topic);
}
```

### 4. `LedgerStatus` interface widening (5 → 8 fields)

3 new fields ADDED; existing 5 fields BYTE-FROZEN at the JSON serialization level (back-compat preserved):

| Field | Type | Status | Purpose |
|-------|------|--------|---------|
| `paired` | `true` | existing | Discriminant |
| `accounts` | `Address[]` | existing (semantics widened) | UNIQUE addresses across all chains (was: addresses on the single chain) |
| `activeAccount` | `Address` | existing | The address `prepare_*` uses as `from` |
| `address` | `Address` | existing | Back-compat alias for `activeAccount` |
| `chainId` | `number` | existing | Back-compat alias for `activeChainId` |
| `sessionTopicLast8` | `string` | existing (Q-CONFIG-LEAK invariant preserved) | Last 8 chars only — NEVER full topic |
| **`accountsByChain`** | `Record<number, Address[]>` | **NEW** | Per-chain account map; drives per-chain scoping |
| **`activeChainId`** | `number` | **NEW** | Currently-active chain (chainId alias) |
| **`partiallyPaired`** | `boolean` | **NEW** | T-WC-PARTIAL-1 flag |

### 5. New module state (per-topic Maps)

```typescript
const activeChainIdByTopic = new Map<string, ChainId>();        // forward-compat for v1.3+ set_active_chain tool
const warnedPartiallyPairedByTopic = new Set<string>();         // once-per-pair-event stderr-warn latch
```

Both cleared in 5 sites (parity with the existing `activeAccountByTopic`): force-pair `pair()` branch, force-pair `pairStart()` branch, `disconnect()`, session_delete listener, `_resetSessionManagerForTesting`.

### 6. `set_active_account` per-chain scope (`src/tools/set_active_account.ts`)

`chain?: ChainName` added to the input schema (optional — back-compat preserved). When provided, the per-chain branch consults `getStatus().accountsByChain[chainId]` BEFORE delegating to `setActiveAccount(address)`:

```typescript
if (chainArg !== undefined) {
  const chainId = chainIdFromName(chainArg as ChainName);
  const preStatus = await getStatus();
  if (preStatus === null) return errEnvelope("WALLET_NOT_PAIRED", "...");
  const chainAccounts = preStatus.accountsByChain[chainId] ?? [];
  const match = chainAccounts.find((a) => a.toLowerCase() === address.toLowerCase());
  if (!match) {
    return errEnvelope(
      "INVALID_ACCOUNT",
      `address not in session for chain ${chainArg} (chainId ${chainId}); chain accounts: ${chainAccounts.join(",")}`,
    );
  }
  // Per-chain check passed — fall through to setActiveAccount.
}
// Cross-chain back-compat fallback when chain omitted.
const status = await setActiveAccount(address);
```

Refusal text names (a) the address, (b) the chain string, (c) the chainId, (d) the per-chain account set with verbatim `(none — chain not covered by current session)` fallback. T-SET-ACTIVE-ACCOUNT-CHAIN-SCOPE-BYPASS-1 mitigation.

## Test Trajectory

| Test File | Before | After | Δ |
|-----------|--------|-------|---|
| `test/session-manager.multi-chain.test.ts` (NEW) | — | 13 | +13 |
| `test/wallet-session-manager.test.ts` (toEqual shape updates) | 34 | 34 | 0 (semantic widening, not new cases) |
| `test/set-active-account.test.ts` (+5 per-chain cases) | 6 | 11 | +5 |
| `test/get-ledger-status.test.ts` (+4 multi-chain + secret-safety) | 6 | 10 | +4 |
| **Total suite** | **767** | **789** | **+22** |

Plan estimate `+20-30 new tests`. Actual `+22` — squarely within the estimate. All 789 tests green; `npm run typecheck` clean; `npm run build` clean.

### Threat-anchor coverage

| Threat | Severity | Disposition | Test anchor |
|--------|----------|-------------|-------------|
| T-WC-PARTIAL-1 | medium | mitigate | `test/session-manager.multi-chain.test.ts` Tests 4 + 5 (partiallyPaired:true + once-per-topic warn) |
| T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1 | low | mitigate | `test/session-manager.multi-chain.test.ts` Test 2 (`eip155:1` first) |
| T-SESSION-TOPIC-LEAK-1 | high | mitigate | `test/session-manager.multi-chain.test.ts` Test 10 + `test/get-ledger-status.test.ts` Test 11 (3-sentinel scan) |
| T-SET-ACTIVE-ACCOUNT-CHAIN-SCOPE-BYPASS-1 | low | mitigate | `test/set-active-account.test.ts` Test 5 (cross-scope bypass blocked) |
| T-WC-PHANTOM-ACCOUNTS-1 | low | accept | Documented residual (device screen at signing is the trust anchor) |
| T-FROZEN-SIGNING-1 | high | mitigate (STOP-THE-LINE) | `git diff origin/main -- src/signing/...` returns EMPTY (verified) |

## FROZEN-Area Assertion

`git diff origin/main` returns EMPTY for ALL of:

- `src/signing/payload-fingerprint.ts`
- `src/signing/presign-hash.ts`
- `src/signing/handle-store.ts`
- `src/tools/send_transaction.ts`
- `src/tools/pair_ledger_live.ts`
- `src/tools/pair_ledger_live_start.ts`
- `src/tools/pair_ledger_live_wait.ts`
- `src/tools/register-all.ts`

Cryptographic-binding chain BYTE-FROZEN. Pair-flow tools BYTE-FROZEN — multi-chain pairing is automatic once `REQUIRED_NAMESPACES.eip155.chains` reflects the configured set; the tools' tool surfaces (input schema, response shape, VERIFY-ON-DEVICE block) need no change.

Per RESEARCH § Topic 9, the preimage already binds `chainId` byte-for-byte; no new fixture literal needed. Fixture J (chain-distinctness property test) lives in Plan 08-02 verbatim per the chain-threading plan.

## Deviations from Plan

### Auto-fixed Issues (Rules 1-3)

**1. [Rule 1 — Bug] `chain` arg interpretation: PLAN body's OPTIONAL beats prompt's REQUIRED paraphrase.**

- **Found during:** Reading the plan + my prompt's `constraints[5]`.
- **Issue:** Prompt constraints said "Add `chain: ChainName` argument (REQUIRED)" with a backward-compat default-to-`ethereum` fallback. The PLAN body (08-05-PLAN.md `interfaces` block) says `chain?: string` OPTIONAL with cross-chain back-compat search when omitted. The constraint was internally contradictory (required but also has back-compat default).
- **Fix:** Followed the PLAN body verbatim — `chain?: string` OPTIONAL. The Phase 5 quick-task `wc-multi-account-session` cross-chain back-compat (`status.accounts.find(...)` when chain omitted) preserved. Making it required would have broken the 6 existing test cases in `test/set-active-account.test.ts` that omit chain.
- **Files modified:** `src/tools/set_active_account.ts` (schema + handler), `test/set-active-account.test.ts` (5 new per-chain cases — existing 6 cases stay green).
- **Commit:** Single atomic commit.

**2. [Rule 1 — Bug] 3 toEqual shape assertions in `test/wallet-session-manager.test.ts` widened for `+3` new `LedgerStatus` fields.**

- **Found during:** First full `npm test` run after the `LedgerStatus` widening.
- **Issue:** Three existing tests used `expect(status).toEqual({ paired, accounts, activeAccount, address, chainId, sessionTopicLast8 })` — strict-shape assertions that fail when new fields are added. These are mechanical updates, not semantic changes.
- **Fix:** Added the 3 new fields (`accountsByChain`, `activeChainId`, `partiallyPaired`) to each `.toEqual({...})` literal with documenting comments. Pair flow and setActiveAccount semantics unchanged — only the shape literal widened.
- **Files modified:** `test/wallet-session-manager.test.ts` lines ~104, ~156, ~394.
- **Commit:** Single atomic commit.

**3. [Rule 2 — Critical] Per-topic cleanup parity for 2 new module-state Maps.**

- **Found during:** Writing the multi-chain accounting block.
- **Issue:** The existing `activeAccountByTopic` Map is cleared in 5 sites (force-pair pair() / force-pair pairStart() / disconnect() / session_delete listener / `_resetSessionManagerForTesting`). Skipping any one site for the new `activeChainIdByTopic` Map + `warnedPartiallyPairedByTopic` Set would let a stale entry survive across a re-pair on the same topic — silent bug class.
- **Fix:** Mirrored the 5-site clear pattern. The session_delete listener clears all three Maps + the warn-latch Set; the partial-pairing warning re-fires on a fresh pair as expected.
- **Files modified:** `src/wallet/session-manager.ts` (4 cleanup-call sites + reset hook).
- **No commit override — folded into the single atomic commit.**

**4. [Rule 1 — Test setup] Added `getStatusSpy` mock to `test/set-active-account.test.ts`.**

- **Found during:** Writing per-chain scope tests.
- **Issue:** The new per-chain branch in `set_active_account.ts` calls `getStatus()` before delegating to `setActiveAccount`. The existing test file's `vi.mock` factory only stubbed `setActiveAccount`; `getStatus` defaulted to the actual function (which requires a real WC client init).
- **Fix:** Added `getStatusSpy = vi.fn(async () => null)` with per-scenario `mockResolvedValue` scripting. The 5 existing test cases (which omit `chain`) don't drive this branch, so they stay green; the 5 new tests script the spy as needed.
- **Files modified:** `test/set-active-account.test.ts`.
- **No commit override — folded into the single atomic commit.**

### Architectural Decisions (Rule 4)

None — every change followed the plan body. The `chain` arg OPTIONAL vs REQUIRED disagreement was a documentation conflict, not an architectural choice; resolved by deferring to the PLAN body per CLAUDE.md plan precedent.

## Hooks for Phase 8 Close-Out

- **Phase 8 retrospective entries (load-bearing from execute time):**
  - Plan body vs orchestrator-prompt constraint conflicts: PLAN body is canonical. The constraint paraphrases in the prompt are summaries, not specifications — when they disagree with the plan, the plan body wins. Worth surfacing in CLAUDE.md as a global discipline rule.
  - The 3-toEqual-shape regression class: any time `LedgerStatus` (or any wire-stable interface) is widened, prior `.toEqual({...})` consumers need mechanical updates. Could be partially mitigated by `.toMatchObject({...})` for non-exhaustive shape assertions OR by an explicit linter rule. v1.3 hygiene task.
  - The "v1.x is mainnet-only" string-in-comment guard caught my first rewrite. The plan's automated grep is strict — it doesn't distinguish comments from code. Future plans removing literal refusal text should also remove (or reword) historical-context comments referencing the removed text verbatim. Worth pinning as a CLAUDE.md or PATTERNS.md note.
- **Compat-shim deletion plan:** 08-05 does NOT touch `src/chains/ethereum.ts` directly (the compat-shim file from Plan 08-02 Deviations §1). The shim deletion remains deferred to the Phase 8 retro chore. 08-05's `LedgerStatus.chainId` back-compat alias for `activeChainId` is a similar shape — both retain in v1.2; v1.3+ may consolidate.
- **Real-Ledger physical-device verify-phase** (A5/A6 deferred per PLAN `<deferred>`): assumptions about Ledger Live's UI multi-chain account-picker behavior are tested via the WC mock-sign-client pattern (`test/helpers/mock-sign-client.ts`). Real-device confirmation that the `partiallyPaired` flag fires under expected conditions (Ledger Live with only Ethereum enabled in Manage Accounts) is a v1.2 verify-phase manual step the user is deferring per the original prompt.

## Accepted Residuals

- **T-WC-PHANTOM-ACCOUNTS-1 (LOW)** — a compromised WC relay could inject phantom accounts in `accountsByChain` for chains the user didn't approve. The device screen at signing time is the trust anchor (Layer 4); phantom-account injection at the MCP layer still requires the user to approve on-device. v1.3 companion `vaultpilot-preflight` skill may add explicit account-allowlist enforcement.
- **`partiallyPaired` requires user-side action** — the flag + stderr warning surface the issue but the resolution (enable missing networks in Ledger Live → Manage Accounts) is user-side. The MCP can't enforce LL configuration; it can only inform.
- **`activeChainId` follows `activeAccount` in v1.2** — when `setActiveAccount(address)` selects an address only present on a non-default chain, the active chain context follows. v1.3+ may add a separate `set_active_chain` tool for independent control (the `activeChainIdByTopic` Map is already in place as the forward-compat slot).
- **`getConfiguredChainIds()` returns ALL 5 chains permissively** — v1.2 doesn't filter by RPC configuration. Users with misconfigured RPC see `rpcDegraded: true` per chain in subsequent reads; no fail-fast at the configuration boundary. v1.3+ may add strict mode.
- **No autonomous real-device verification possible** — the executor has no Ledger device. The mock-sign-client pattern proves the MCP-side logic; A4/A5/A6 (Ledger Live UI behavior under multi-chain pair) await physical-device verify-phase.

## Authentication Gates

None encountered. All work was code + test edits.

## Self-Check: PASSED

Files asserted present:
- `.planning/phases/08-multi-evm-fan-out-token-tooling/08-05-SUMMARY.md` — THIS FILE
- `src/config/env.ts` — `getConfiguredChainIds` present
- `src/wallet/session-manager.ts` — `accountsByChain`, `activeChainId`, `partiallyPaired`, no hardcoded `["eip155:1"]`, no `v1.x is mainnet-only` substring
- `src/tools/set_active_account.ts` — `accountsByChain` consumed; `chain` arg in schema
- `test/session-manager.multi-chain.test.ts` — 13 cases
- `test/wallet-session-manager.test.ts` — 3 toEqual updates (existing tests still 34 cases, all green)
- `test/set-active-account.test.ts` — 11 cases (6 baseline + 5 new)
- `test/get-ledger-status.test.ts` — 10 cases (6 baseline + 4 new)

FROZEN-area diff:
- `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` — EMPTY
- `git diff origin/main -- src/tools/pair_ledger_live.ts src/tools/pair_ledger_live_start.ts src/tools/pair_ledger_live_wait.ts` — EMPTY
- `git diff origin/main -- src/tools/register-all.ts` — EMPTY

Final test trajectory: **767 → 789 (+22)**. `npm run typecheck` clean. `npm run build` clean. Branch: `feat/08-05-walletconnect-multi-chain`.
