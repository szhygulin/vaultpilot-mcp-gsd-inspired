# Phase 11: Patterns — Solana scaffolding + USB-HID + persistent non-EVM account cache

**Mapped:** 2026-05-20
**Files classified:** 14 new + 2 modified
**Analogs found:** 14 / 14 (every new file has a clean v1.x analog)

---

## Pattern-mapper meta-decisions

Two decisions resolved up-front so individual plans don't re-litigate:

1. **`get_portfolio_summary` — extend in place, do NOT fork a Solana-only tool.** Today's tool is already multi-chain shaped (`perChain: Partial<Record<ChainName, ChainPortfolio>>`, per-row `chain: ChainName` tag, `Promise.allSettled` fan-out, per-chain timeout + `chainErrors` partial-result envelope). The Phase 8 retro is explicit: cross-chain rows MUST carry a `chain` field so the agent can flatten without losing context. Forking a `get_solana_portfolio_summary` would split the wallet's full picture across two tools — the user has to ask twice and the agent has to fuse, exactly the kind of asymmetry the Phase 8 fan-out architecture is built to avoid. Plan 11-05 widens `ChainName` to a discriminated union (EVM-shape vs `"solana"`-shape rows) and adds a Solana leg to the fan-out.

2. **`solana-persona.ts` — new dedicated module, do NOT mutate `src/demo/personas.ts`.** Today's `Persona` interface is strongly typed to EVM (`address: Address` from viem's hex-checksum brand; `slug` literal-union locked to 4 EVM personas). Adding a Solana persona via the same `slug` union creates a load-bearing cross-namespace coupling — the EVM literal-union shouldn't widen to accept base58. Cleaner: a sibling `SolanaPersona` interface with a `solanaAddress: string` field, exported from `src/demo/solana-persona.ts`, consumed by `set_demo_wallet` via a sibling registration path (Plan 11-06).

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/chains/solana/registry.ts` | chain registry | factory + memoize | [`src/chains/registry.ts`](../../src/chains/registry.ts) | exact-role, simpler (single chain in v1.x) |
| `src/chains/solana/sol-rpc-client.ts` | chain-RPC helper | request-response | [`src/chains/erc20-scanner.ts`](../../src/chains/erc20-scanner.ts) | sibling-shelf (chain-namespaced helper) |
| `src/wallet/non-evm-account-store.ts` | persistent cache | file-I/O (atomic) | [`src/wallet/session-manager.ts`](../../src/wallet/session-manager.ts) + [`src/config/wc-storage.ts`](../../src/config/wc-storage.ts) | exact (persistence shape + 0o700 perms) |
| `src/wallet/ledger-solana-transport.ts` | transport singleton | lazy-init + cache | [`src/wallet/walletconnect-client.ts`](../../src/wallet/walletconnect-client.ts) | exact (lazy-singleton + `_<scope>` indirection) |
| `src/config/non-evm-storage.ts` | env resolver + paths | request-response | [`src/config/wc-storage.ts`](../../src/config/wc-storage.ts) | exact (Q-STRICT env + 0o700 dir helpers) |
| `src/tools/pair_solana_ledger.ts` | MCP tool (pair) | request-response | [`src/tools/pair_ledger_live.ts`](../../src/tools/pair_ledger_live.ts) | exact role; USB-HID body differs (no URI to surface) |
| `src/tools/get_solana_status.ts` | MCP tool (status) | request-response | [`src/tools/get_ledger_status.ts`](../../src/tools/get_ledger_status.ts) | exact |
| `src/tools/get_solana_balance.ts` | MCP tool (read) | request-response | [`src/tools/get_token_balance.ts`](../../src/tools/get_token_balance.ts) | exact role; SOL/SPL shape differs |
| `src/tools/get_solana_token_balance.ts` | MCP tool (read) | request-response | [`src/tools/get_token_balance.ts`](../../src/tools/get_token_balance.ts) | exact role; SPL mint addressing |
| `src/tools/list_paired_non_evm_accounts.ts` | MCP tool (list) | request-response | [`src/tools/get_ledger_status.ts`](../../src/tools/get_ledger_status.ts) | partial (read-from-store, no live session) |
| `src/tools/remove_paired_non_evm_account.ts` | MCP tool (mutate) | request-response | [`src/wallet/session-manager.ts`](../../src/wallet/session-manager.ts) `disconnect()` shape | partial (no live session; pure store delete) |
| `src/demo/solana-persona.ts` | demo data | static registry | [`src/demo/personas.ts`](../../src/demo/personas.ts) | role-match (curated registry shape) |
| **MOD** `src/tools/register-all.ts` | side-effect register | additive imports | (itself) | additive |
| **MOD** `src/tools/get_portfolio_summary.ts` | MCP tool | request-response | (itself) | extension — Solana leg in fan-out |
| **MOD** `src/server.ts` | startup wiring | request-response | (itself) | one-line eager-init call (mirrors `eagerInitWalletConnectIfPersist`) |
| **MOD** `src/config/env.ts` | env getters | request-response | (itself) | additive `getSolanaRpcUrl()` |

Test files mirror the analog's test (12 new test files — full list in §Test patterns).

---

## Pattern Assignments (by new plan)

### Plan 11-01 — Persistent non-EVM account store + eager-init wiring

**New files:**
- `src/wallet/non-evm-account-store.ts`
- `src/config/non-evm-storage.ts`

**Modified files:**
- `src/server.ts` (one-line: `await eagerInitNonEvmStoreIfPersist();` BEFORE `server.connect(transport)`)

**Primary analog:** [`src/wallet/session-manager.ts`](../../src/wallet/session-manager.ts) (storage shape + `_storage` ESM spy-affordance) + [`src/wallet/walletconnect-client.ts`](../../src/wallet/walletconnect-client.ts) (eager-init pattern) + [`src/config/wc-storage.ts`](../../src/config/wc-storage.ts) (env resolver + 0o700 dir + atomic clear).

**Bounded diffs:**

1. **`src/config/non-evm-storage.ts`** — mirror `src/config/wc-storage.ts` line-by-line:
   - `getNonEvmStorageMode()` — Q-STRICT env resolver on `VAULTPILOT_NON_EVM_STORAGE`, accepts only `"memory" | "persist"`, default `"persist"`. Same `process.exit(1)` refusal on unrecognized values as `getWalletConnectStorageMode()` (see `wc-storage.ts:56-66`).
   - `getNonEvmStoragePath()` — returns `~/.vaultpilot-mcp/non-evm-accounts.json` (a FILE, not a directory — single-JSON shape is simpler than WC's keys-as-files because the data set is small: 4 chains max).
   - `ensureStorageDirWithPerms()` — same shape as `wc-storage.ts:95-138`, but scope is the PARENT dir (`~/.vaultpilot-mcp`) since the cache itself is a single file. 0o700 parent dir, 0o600 file (see acceptance #5 in CONTEXT.md `<decisions>`).

2. **`src/wallet/non-evm-account-store.ts`** — mirror `src/wallet/session-manager.ts`:
   - Schema: `{ chain: "solana" | "tron" | "bitcoin" | "litecoin", address: string, derivationPath: string, pairedAt: string, displayName?: string }[]`.
   - Atomic write: `writeFileSync(tmp, json, { mode: 0o600 })` → `renameSync(tmp, finalPath)`. Tempfile under same dir to keep the rename same-filesystem.
   - Exports: `loadAccounts()`, `saveAccount(record)`, `removeAccount(chain, address)`, `listAccounts({ chainFilter? })`, `eagerInitNonEvmStoreIfPersist()` (mirrors `eagerInitWalletConnectIfPersist` at `walletconnect-client.ts:173-186` — silent skip if mode is `"memory"`, catches + stderr-warns on disk errors so a corrupt cache cannot abort startup).
   - **ESM spy-affordance** (CLAUDE.md convention): `export const _storage = { readFileSync, writeFileSync, renameSync, ensureStorageDirWithPerms };` — every internal cross-export call goes through `_storage.X` so tests can spy. Pattern source: `src/wallet/session-manager.ts:48-54` (`_storage`) + `walletconnect-client.ts:38-48` (`_wcStorage`).
   - **Stale-session detection**: when `Date.now() - new Date(record.pairedAt).getTime() > 30 * 24 * 3600 * 1000`, surface `staleAccountWarning: true` on the read path (CONTEXT.md `<decisions>`).
   - Test-only reset: `_resetNonEvmStoreForTesting()` mirroring `_resetSessionManagerForTesting` at `session-manager.ts:833-843`.

3. **`src/server.ts`** — single insertion at `server.ts:211`:
   ```typescript
   // After eagerInitWalletConnectIfPersist():
   await eagerInitNonEvmStoreIfPersist();
   ```
   Both eager-inits run BEFORE `server.connect(transport)` so the first `get_solana_status` after cold boot returns paired-from-cache rather than re-pair-required (PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61) precedent).

### Plan 11-02 — Solana RPC client + chain registry

**New files:**
- `src/chains/solana/registry.ts`
- `src/chains/solana/sol-rpc-client.ts`

**Modified files:**
- `src/config/env.ts` (additive `getSolanaRpcUrl()`)

**Primary analog:** [`src/chains/registry.ts`](../../src/chains/registry.ts) for the registry; [`src/chains/erc20-scanner.ts`](../../src/chains/erc20-scanner.ts) for the helper-module shape.

**Bounded diffs:**

1. **`src/chains/solana/registry.ts`** — narrower than EVM registry (single mainnet-beta cluster in v1.x; devnet/testnet deferred):
   - Resolution priority mirrors `registry.ts:287-319` `getChainClient(chainId)`:
     - (1) `SOLANA_RPC_URL` env override wins
     - (2) Public RPC fallback (`https://api.mainnet-beta.solana.com`) with once-per-process stderr warn (same warn-latch pattern as `warnedFallbackByChain` at `registry.ts:122`)
   - No `RPC_PROVIDER` shorthand fan-out (Helius / QuickNode shorthand is v2.1+ scope — keep this phase narrow).
   - Lazy singleton (`Connection` instance from chosen Solana SDK). `_solanaRegistry` ESM spy-affordance object mirroring `_registry` at `registry.ts:385-392`.
   - Do NOT widen the EVM `ChainId` literal-union — Solana is a separate namespace per CONTEXT.md `<specifics>`.

2. **`src/chains/solana/sol-rpc-client.ts`** — thin wrapper around `Connection.getBalance` + `getParsedTokenAccountsByOwner`. Returns `{ lamports: bigint, sol: string }` for native, `{ mint, amount, decimals, uiAmount }` rows for SPL. Decimal-string-at-the-boundary per CLAUDE.md (no `number` types crossing into JSON).

3. **`src/config/env.ts`** — additive `getSolanaRpcUrl()` mirroring `getEthereumRpcUrl()` at `env.ts:38-40` (3-line copy with renamed env-var key).

### Plan 11-03 — USB-HID Ledger transport (Solana app)

**New files:**
- `src/wallet/ledger-solana-transport.ts`

**Primary analog:** [`src/wallet/walletconnect-client.ts`](../../src/wallet/walletconnect-client.ts).

**Bounded diffs:**

- Lazy singleton (`@ledgerhq/hw-transport-node-hid`'s `default.create()` returns a Promise of a `Transport`). Cached as `cachedTransport`, `initInFlight` shared-promise dedup — exact shape from `walletconnect-client.ts:71-72,100-137`.
- ESM spy-affordance: `export const _transport = { create, list }` so tests can `vi.spyOn(_transport, "create")`. Pattern source: `_wcStorage` at `walletconnect-client.ts:38-48`.
- Error class: `LedgerDeviceNotConnectedError extends Error` (mirrors `MissingProjectIdError` at `walletconnect-client.ts:83-91`) — thrown when `Transport.list()` returns empty. Message names the recovery action: "connect your Ledger via USB, unlock it, and open the Solana app."
- `eagerInit...` is NOT exported here — the transport is opened on-demand by `pair_solana_ledger`. Persistence lives in the account store (Plan 11-01); the transport itself is per-process.
- Test-only `_resetLedgerSolanaTransportForTesting()` mirroring `_resetWalletConnectClientForTesting` at `walletconnect-client.ts:212-215`.

### Plan 11-04 — Pair + status MCP tools

**New files:**
- `src/tools/pair_solana_ledger.ts`
- `src/tools/get_solana_status.ts`
- `src/tools/list_paired_non_evm_accounts.ts`
- `src/tools/remove_paired_non_evm_account.ts`

**Modified files:**
- `src/tools/register-all.ts` (4 additive import lines)

**Primary analog:** [`src/tools/pair_ledger_live.ts`](../../src/tools/pair_ledger_live.ts) (handler-body shape + VERIFY-ON-DEVICE template) + [`src/tools/get_ledger_status.ts`](../../src/tools/get_ledger_status.ts).

**Bounded diffs:**

1. **`src/tools/pair_solana_ledger.ts`** — mirror `pair_ledger_live.ts:99-210` handler-body shape:
   - Demo-mode FIRST refusal (`pair_ledger_live.ts:102-114`).
   - No `wcUri` to surface; instead the response prompts "connect your Ledger via USB + open the Solana app + confirm the address on-device." The handler awaits the transport (lazy-init from Plan 11-03), calls the Solana app's `getAddress(derivationPath)`, and races against a 60s budget (mirrors `APPROVAL_TIMEOUT_MS` at `session-manager.ts:85`).
   - Persist via `saveAccount({ chain: "solana", address, derivationPath, pairedAt })` from Plan 11-01's store.
   - Export `VERIFY_ON_DEVICE_SOLANA_TEMPLATE` as the single-source-of-truth constant (mirrors `VERIFY_ON_DEVICE_TEMPLATE` at `pair_ledger_live.ts:65-75`) — substituted with `{ADDRESS}` + `{DERIVATION_PATH_LAST_INDEX}` (NOT full path — shoulder-surfing defense from CONTEXT.md `<specifics>`).
   - Locked errorCode set: `LEDGER_NOT_CONNECTED`, `SOLANA_APP_NOT_OPEN`, `USER_REJECTED`, `APPROVAL_TIMEOUT`, `DEMO_MODE_REFUSED`. Last-resort `INTERNAL_ERROR` outside the locked set (mirrors `pair_ledger_live.ts:200-208`).

2. **`src/tools/get_solana_status.ts`** — mirror `get_ledger_status.ts` end-to-end. Read from Plan 11-01's `listAccounts({ chainFilter: "solana" })` instead of the WC session-manager `getStatus()`. Returns `{ paired: false }` if no Solana record; `{ paired: true, address, pairedAt, staleAccountWarning? }` otherwise.

3. **`src/tools/list_paired_non_evm_accounts.ts`** — calls `listAccounts()` from Plan 11-01. **Critical**: response shape MUST omit `derivationPath` from both `content[0].text` AND `structuredContent` (CONTEXT.md `<specifics>` — shoulder-surfing defense; the derivation path leaks the BIP44 account index). Locked tests asserting absence of `derivationPath` in the response.

4. **`src/tools/remove_paired_non_evm_account.ts`** — calls `removeAccount(chain, address)` from Plan 11-01. Idempotent — removing a non-existent record returns `{ removed: false }` rather than erroring (mirrors `disconnect()` shape at `session-manager.ts:683-691`).

5. **`src/tools/register-all.ts`** — additive imports, positioned per the wave structure below.

### Plan 11-05 — Solana balance reads + `get_portfolio_summary` extension

**New files:**
- `src/tools/get_solana_balance.ts`
- `src/tools/get_solana_token_balance.ts`

**Modified files:**
- `src/tools/get_portfolio_summary.ts` (Solana leg in fan-out)
- `src/tools/register-all.ts` (2 additive import lines)

**Primary analog:** [`src/tools/get_token_balance.ts`](../../src/tools/get_token_balance.ts).

**Bounded diffs:**

1. **`src/tools/get_solana_balance.ts`** — mirror `get_token_balance.ts:48-117`:
   - Input schema: `{ wallet: string (base58, regex `^[1-9A-HJ-NP-Za-km-z]{32,44}$`) }`. No `chain` arg (Solana-only tool).
   - Calls Plan 11-02's `sol-rpc-client.getBalance(wallet)`.
   - Response: `{ balance: "<decimal-string>", decimals: 9, symbol: "SOL" }`. Decimal-aware per CLAUDE.md.
   - Error envelope shape: same `isError: true` + `content[0].text` + `structuredContent` triple as `get_token_balance.ts:105-115`.

2. **`src/tools/get_solana_token_balance.ts`** — same shape as `get_solana_balance.ts` but for a single SPL mint. Input: `{ wallet, mintAddress }`. Calls `getParsedTokenAccountsByOwner` filtered to the mint.

3. **`src/tools/get_portfolio_summary.ts`** — surgical extension to the existing fan-out at `get_portfolio_summary.ts:118-...`:
   - Widen `ALL_CHAINS` (at `get_portfolio_summary.ts:21-28`) to include `"solana"` ONLY IF Plan 11-01's account store has a paired Solana account AND `getSolanaRpcUrl()` is configured (skip silently otherwise — matches the EVM "no chain configured" behavior).
   - Add a Solana leg to the `Promise.allSettled` fan-out with the same 10s `PER_CHAIN_TIMEOUT_MS`. The leg returns a `ChainPortfolio` shape with a `"solana"`-tagged row.
   - Discriminated union widening: `interface Erc20BalanceRow { chain: "ethereum" | ... }` becomes `Erc20BalanceRow | SplBalanceRow`. Keep the EVM `Erc20BalanceRow.chain` literal-union narrow; add a parallel `SplBalanceRow { chain: "solana", mintAddress, ... }`. The `chain` field discriminator stays load-bearing.
   - `chainErrors` envelope reuses the existing shape (`{ chain, reason }`).
   - **Backward compat**: existing EVM-only `wallet` arg keeps a 5-EVM fan-out. New optional `includeSolana: boolean` arg (default true if a Solana account is paired) toggles the Solana leg. Plan should propose: agent's `wallet` arg is the EVM address; the Solana leg uses the paired Solana address from the store, NOT a Solana address passed via `wallet`. (If user wants a Solana-only portfolio, call `get_solana_balance` + `get_solana_token_balance` per-mint or accept that v1.x leaves Solana-only portfolio fan-out to a v2.0.1 verify-phase.)

### Plan 11-06 — Demo persona for Solana

**New files:**
- `src/demo/solana-persona.ts`

**Modified files:**
- `src/tools/set_demo_wallet.ts` (additive Solana branch — extend the persona resolution)
- `src/tools/register-all.ts` (no change — `set_demo_wallet` already registered)

**Primary analog:** [`src/demo/personas.ts`](../../src/demo/personas.ts).

**Bounded diffs:**

1. **`src/demo/solana-persona.ts`** — mirror `personas.ts:25-84`:
   - Sibling `SolanaPersona` interface (does NOT widen `Persona.slug` literal-union — keeps EVM/Solana namespaces clean per meta-decision §2 above).
   - VERIFICATION RITUAL comment block per `personas.ts:11-22` — Solana address byte-identity locked at the literal site via the SDK's address validator (e.g. `new PublicKey("...")` throws at MODULE LOAD on a malformed base58 string; same DOA pattern as `getAddress(...)` in EVM personas).
   - Single curated persona for v1.x (top-50 SOL holder per CONTEXT.md `<decisions>`); v2.1+ may add more.
   - Demo-mode simulation envelope: `simulateTransaction` not `eth_call` (Phase 12 wires this; Phase 11 only seeds the registry).

2. **`src/tools/set_demo_wallet.ts`** — additive branch: if the agent passes a Solana persona slug, set the active Solana demo persona instead of the EVM one. Both can be active simultaneously (the agent may switch between EVM read-flows and Solana read-flows without re-selecting per-chain). Plan should sketch this against the existing `setActivePersona()` shape.

---

## Test Patterns (per new plan)

Every new test mirrors the EXACT shape of the named v1.x analog. The full-shape inheritance means:
- Same `vi.mock` factories
- Same `beforeEach` / `afterEach` env-pin + reset-for-testing pair
- Same `_resetX` test-only-reset call (every new module exports one)
- Same `vi.spyOn(_<scope>, "method")` indirection pattern

| New Test | Mirror | Notes |
|---|---|---|
| `test/non-evm-account-store.test.ts` | [`test/wallet-session-manager.test.ts`](../../test/wallet-session-manager.test.ts) (832 LOC, persistence + spy-affordance shape) | `_storage` spy mocks `readFileSync` / `writeFileSync` / `renameSync` |
| `test/non-evm-store.eager-init.test.ts` | [`test/wallet-session-manager.eager-init.test.ts`](../../test/wallet-session-manager.eager-init.test.ts) (177 LOC, end-to-end regression anchor) | gates (memory mode skip, missing env skip), idempotency, disk-error stderr-warn |
| `test/config-non-evm-storage.test.ts` | [`test/config-wc-storage.test.ts`](../../test/config-wc-storage.test.ts) (260 LOC) | Q-STRICT env tests + perm-aware bootstrap + tempfile teardown |
| `test/ledger-solana-transport.test.ts` | [`test/wallet-walletconnect-client.test.ts`](../../test/wallet-walletconnect-client.test.ts) (273 LOC) | lazy-singleton + `Transport.list()` mocking via `_transport` spy |
| `test/chains-solana-registry.test.ts` | [`test/chains-registry.test.ts`](../../test/chains-registry.test.ts) | env-override + PublicRPC fallback + once-per-process warn-latch |
| `test/pair-solana-ledger.test.ts` | [`test/pair-ledger-live.test.ts`](../../test/pair-ledger-live.test.ts) (277 LOC) | demo-mode FIRST refusal + VERIFY-ON-DEVICE template substitution + 5 locked errorCodes |
| `test/get-solana-status.test.ts` | [`test/get-ledger-status.test.ts`](../../test/get-ledger-status.test.ts) | `paired: false` / `paired: true` envelope shape |
| `test/get-solana-balance.test.ts` | [`test/get-token-balance.test.ts`](../../test/get-token-balance.test.ts) (130 LOC) | base58 validation + decimal-string boundary + RPC error envelope |
| `test/get-solana-token-balance.test.ts` | [`test/get-token-balance.test.ts`](../../test/get-token-balance.test.ts) | SPL mint variant |
| `test/get-portfolio-summary.solana.test.ts` | [`test/get-portfolio-summary.cross-chain.test.ts`](../../test/get-portfolio-summary.cross-chain.test.ts) (358 LOC) | Solana leg in fan-out + `chainErrors` partial-result envelope |
| `test/list-paired-non-evm-accounts.test.ts` | [`test/get-ledger-status.test.ts`](../../test/get-ledger-status.test.ts) | **Critical regression**: assert `derivationPath` is ABSENT from response (shoulder-surfing defense) |
| `test/remove-paired-non-evm-account.test.ts` | [`test/wallet-session-manager.test.ts`](../../test/wallet-session-manager.test.ts) `disconnect` tests | Idempotent — non-existent removal returns `{ removed: false }`, no throw |
| `test/solana-persona.test.ts` | [`test/demo-state.test.ts`](../../test/demo-state.test.ts) | DOA base58 validation at module load |

---

## Shared Patterns (cross-cutting; apply to every relevant plan)

### Pattern A — ESM spy-affordance indirection (CLAUDE.md convention)

**Source:** [`src/wallet/session-manager.ts:48-54`](../../src/wallet/session-manager.ts) (`_storage`); [`src/wallet/walletconnect-client.ts:38-48`](../../src/wallet/walletconnect-client.ts) (`_wcStorage`); [`src/chains/registry.ts:385-392`](../../src/chains/registry.ts) (`_registry`).

**Apply to:**
- `non-evm-account-store.ts` — export `_storage = { readFileSync, writeFileSync, renameSync, ensureStorageDirWithPerms }`
- `ledger-solana-transport.ts` — export `_transport = { create, list }`
- `chains/solana/registry.ts` — export `_solanaRegistry = { getConnection, getSolanaRpcUrl }`

Pattern is non-optional per CLAUDE.md "Add the indirection at write time, not retroactively." Internal cross-export calls MUST go through `_X.method`, not the bare import — ESM named-export bindings are immutable, so a direct `vi.spyOn(module, "method")` silently no-ops.

### Pattern B — Eager-init at startServer, BEFORE transport.connect()

**Source:** [`src/server.ts:200-215`](../../src/server.ts) + [`src/wallet/walletconnect-client.ts:173-186`](../../src/wallet/walletconnect-client.ts).

**Apply to:** Plan 11-01's `eagerInitNonEvmStoreIfPersist()` invoked from `startServer()` right after `eagerInitWalletConnectIfPersist()`. Both run BEFORE `server.connect(transport)` so the first tool dispatch sees a primed store. Silent skip on missing env / memory mode. Disk-error → stderr `log("warn", ...)` only; MUST NOT throw (server must still serve read-only tools when the cache is unreachable).

### Pattern C — Q-STRICT env resolution + `process.exit(1)` on unrecognized values

**Source:** [`src/config/wc-storage.ts:56-66`](../../src/config/wc-storage.ts).

**Apply to:** `src/config/non-evm-storage.ts::getNonEvmStorageMode()`. `VAULTPILOT_NON_EVM_STORAGE` accepts ONLY the literal strings `"memory"` and `"persist"`; anything else (`"Memory"`, `"1"`, etc.) triggers `log("error", ...) + process.exit(1)`. Fail-safe defaults: uncertainty defaults to denial. Mirrors `VAULTPILOT_WC_STORAGE` behavior exactly.

### Pattern D — Tool description as agent routing prompt

**Source:** [`src/tools/pair_ledger_live.ts:77-85`](../../src/tools/pair_ledger_live.ts) (DESCRIPTION array → `.join(" ")`).

**Apply to:** Every new tool's `DESCRIPTION`. State each idea once. Cut hedging adjectives. Routing hints first ("Use this when X, NOT when Y"). Per CLAUDE.md `## Conventions`. Tool description MUST be ≥ 100 chars (`src/tools/index.ts:28` `MIN_DESCRIPTION_LEN`).

### Pattern E — Decimal-string-at-the-boundary

**Source:** [`src/tools/get_token_balance.ts:92-93`](../../src/tools/get_token_balance.ts) (`balance = formatUnits(balanceRaw, decimals)`).

**Apply to:** `get_solana_balance.ts` + `get_solana_token_balance.ts`. SOL has 9 decimals (1 SOL = 10⁹ lamports); SPL mints carry their own `decimals` field via `getParsedTokenAccountsByOwner`. Convert via decimal-string formatter (no `number` types cross into the JSON response). Off-by-decimal is the most common user-facing bug per CLAUDE.md `## Conventions`.

### Pattern F — Locked errorCode envelopes

**Source:** [`src/tools/pair_ledger_live.ts:99-209`](../../src/tools/pair_ledger_live.ts) (5 locked codes + `INTERNAL_ERROR` last-resort fallback).

**Apply to:** Every new pair / read / mutate tool. The errorCode set is named in the tool's top-of-file comment block (locked contract). New codes for Phase 11: `LEDGER_NOT_CONNECTED`, `SOLANA_APP_NOT_OPEN`, `STALE_ACCOUNT_WARNING` (informational, not an error). `INTERNAL_ERROR` is the unstructured fallback for unexpected `Error` instances.

---

## FROZEN areas (do NOT touch — verified absent from every plan's "Modified files")

Per project CLAUDE.md `## Architecture` + v1.x phase retros — the cryptographic-binding pipeline is byte-frozen:

- `src/signing/payload-fingerprint.ts`
- `src/signing/presign-hash.ts`
- `src/signing/handle-store.ts`
- `src/signing/blocks.ts`
- `src/signing/error-codes.ts`
- `src/signing/amount.ts`
- `src/signing/resolve-from.ts`
- `src/signing/simulation.ts`
- `src/signing/aave-health.ts`
- `src/tools/send_transaction.ts` (three-gate region)
- `src/tools/preview_send.ts` (preview-token shape)
- `src/security/canonical-dispatch.ts`
- `src/security/skill-integrity.ts`

**Verification:** Phase 11 is reads-only + USB-HID pairing — no `prepare_*` / `preview_send` / `send_transaction` Solana variants. Those land in Phase 12 (the Solana trust pipeline). Every plan in this PATTERNS.md leaves the FROZEN list untouched. **Status: all FROZEN files NOT touched — verified.**

---

## Coordination Points (multi-plan carve)

### `src/tools/register-all.ts` — touched by Plans 11-04 + 11-05

Phase 8 / 9 / 10 precedent: each plan adds its tool imports in a deterministic position to minimize merge conflicts. Recommendation: **assign line-number ranges per plan** at carve time so parallel waves can independently append without textual collision:

| Plan | Imports added | Position rule |
|---|---|---|
| 11-04 | `pair_solana_ledger`, `get_solana_status`, `list_paired_non_evm_accounts`, `remove_paired_non_evm_account` | After line 14 (`get_ledger_status.js`) — group with the other Ledger-pairing tools |
| 11-05 | `get_solana_balance`, `get_solana_token_balance` | After line 9 (`get_portfolio_summary.js`) — group with the other balance reads |

When Plan 11-04 and Plan 11-05 land in the same wave, the merge is conflict-free because they touch non-overlapping line ranges.

### `src/server.ts` startup — touched by Plan 11-01 ONLY

Plan 11-01 is the only plan that modifies `server.ts` (the one-line `eagerInitNonEvmStoreIfPersist()` insertion). No coordination needed.

### `src/tools/get_portfolio_summary.ts` — touched by Plan 11-05 ONLY

Single-plan modification. The widening is non-trivial (discriminated-union `Erc20BalanceRow | SplBalanceRow`) but contained to one file.

---

## Wave Structure

```
Wave 1: 11-01 (persistent non-EVM account store + eager-init wiring)
        └─ foundational — every downstream plan reads/writes this store

Wave 2: 11-02 (Solana RPC client + chain registry)  ∥  11-03 (USB-HID transport)
        ├─ 11-02 independent — adds new chain namespace, no dep on store
        └─ 11-03 independent — adds transport singleton, no dep on store

Wave 3: 11-04 (pair_solana_ledger + get_solana_status + list/remove tools)
        ├─ depends on 11-01 (account store) + 11-03 (transport)
        └─ touches register-all.ts (deterministic position above)

Wave 4: 11-05 (Solana balance reads + get_portfolio_summary extension)  ∥  11-06 (Solana demo persona)
        ├─ 11-05 depends on 11-01 (read paired Solana addr) + 11-02 (RPC client)
        ├─ 11-06 independent — sibling registry, no dep on signing/RPC
        └─ both touch register-all.ts (deterministic positions above; no overlap)
```

**Parallel-eligible pairs:**
- Wave 2: 11-02 ∥ 11-03 (independent — different src trees, no shared files)
- Wave 4: 11-05 ∥ 11-06 (independent — `register-all.ts` positions assigned to avoid collision; 11-05 modifies `get_portfolio_summary.ts` which 11-06 does not touch)

**Strict-sequential pairs:**
- 11-01 → all (foundational store)
- 11-03 → 11-04 (transport must exist before pairing tool)
- 11-02 → 11-05 (RPC client must exist before balance reads)

**Plan count proposed: 6** (11-01 through 11-06).

---

## Metadata

**Analog search scope:** `src/wallet/`, `src/chains/`, `src/tools/`, `src/demo/`, `src/config/`, `src/server.ts`, `test/`.
**Files read in full:** `session-manager.ts` (844 LOC), `walletconnect-client.ts` (216 LOC), `chains/registry.ts` (393 LOC), `wc-storage.ts` (166 LOC), `pair_ledger_live.ts` (211 LOC), `pair_ledger_live_start.ts` (130 LOC), `pair_ledger_live_wait.ts` (164 LOC), `get_ledger_status.ts` (63 LOC), `get_token_balance.ts` (118 LOC), `get_portfolio_summary.ts` (top 120 LOC for shape), `personas.ts` (85 LOC), `caip.ts` (39 LOC), `server.ts` (216 LOC), `tools/index.ts` (61 LOC), `config/contracts.ts` (80 LOC), `config/env.ts` (top 100 LOC), `wallet-session-manager.eager-init.test.ts` (full), `wallet-walletconnect-client.test.ts` (top 120 LOC), `pair-ledger-live.test.ts` (top 120 LOC), `config-wc-storage.test.ts` (top 60 LOC).
**Pattern extraction date:** 2026-05-20.
