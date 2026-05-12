# Phase 3: WalletConnect pairing — Research

**Researched:** 2026-05-12
**Domain:** WalletConnect v2 Sign protocol, dapp-side session lifecycle, Ledger Live as wallet peer
**Confidence:** HIGH (API surface verified against installed `@walletconnect/sign-client@2.23.9` type defs; one open question about default session-expiry value, flagged below)

## Summary

- **SDK is `@walletconnect/sign-client@2.23.9`** (latest stable, published 2026-04 per npm registry) [VERIFIED: `npm view @walletconnect/sign-client`]. Dual ESM/CJS exports — works in this repo's `"type": "module"` posture. Bundle pulls 9 direct deps including `@walletconnect/core`, `@walletconnect/utils`, `@walletconnect/keyvaluestorage`, plus `unstorage` + `idb-keyval` transitively (~5MB unpacked total). [VERIFIED: `/tmp/wc-probe/node_modules/@walletconnect/*/package.json`]
- **Dapp flow is two-step**: `SignClient.init({ projectId, metadata })` returns a long-lived client; `signClient.connect({ requiredNamespaces })` returns `{ uri, approval }` where `uri` is the WC URI the user pastes into Ledger Live and `approval` is a `() => Promise<SessionTypes.Struct>` that resolves on wallet-side approval. No built-in client-side timeout on `approval()` — implement via `Promise.race`. [VERIFIED: `IEngine.connect` signature in `@walletconnect/types/dist/types/sign-client/engine.d.ts:307-310`]
- **Default Node storage writes to a `walletconnect.db` file** via `unstorage` fs-lite driver. The MCP server requires no persistence (fresh process = fresh session by design — sessions are short-lived hardware-pairing handshakes, not user-session cookies). Pass `storageOptions: { dbName: ":memory:" }` to opt into in-memory KV. [VERIFIED: `@walletconnect/keyvaluestorage/dist/index.cjs.js` source, sentinel `":memory:"` triggers `createStorage()` with no driver].
- **Ledger Live's `eip155` namespace supports** `personal_sign`, `eth_sign`, `eth_signTransaction`, `eth_signTypedData{,_v3,_v4}`, `eth_sendTransaction`, `eth_accounts`, `eth_requestAccounts`. [CITED: github.com/LedgerHQ/wallet-connect-live-app `src/data/methods/EIP155Data.methods.ts`]. Phase 3 only needs to *declare* what Phase 4 will exercise — we declare `eth_sendTransaction` + `personal_sign` so Phase 4 inherits a usable session without re-pairing.
- **Session topic provenance** is straightforward: `session.topic` is a hex string set by the relay during the pairing handshake; it's stable for the session's lifetime; `sessionTopicLast8 = session.topic.slice(-8)` is what surfaces to the user for the Ledger Live cross-check. [VERIFIED: `SessionTypes.Struct.topic` in `session.d.ts:23`]

**Primary recommendation:** Plan 03-01 lands `src/wallet/walletconnect-client.ts` (lazy-singleton `SignClient`, mirrors `src/chains/ethereum.ts`) + `src/wallet/session-manager.ts` (cached session, `pair()` / `getStatus()` / `disconnect()` API). Plan 03-02 lands `src/tools/pair_ledger_live.ts` + `src/tools/get_ledger_status.ts` as thin handlers over the session-manager. The session manager is what Phase 4 imports to find the topic to route `eth_sendTransaction` over.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Generating WC pairing URI | MCP server (this codebase) | WC relay (HTTPS) | Dapp-role only — we author the proposal; the relay just transports |
| Displaying URI / scanning | Ledger Live (host app) | — | Out of our control; we hand off the URI string |
| Approving the session | Ledger device + Ledger Live | — | Trust anchor; we observe approval via `approval()` promise resolving |
| Storing session state | MCP server (in-memory) | — | Process-local cache; no persistence (DEMO/refusal semantics, fresh-pair-per-process by design) |
| Surfacing topic to user | MCP server (response text) | Ledger Live (Settings → Connected Apps) | Cross-check pattern: server emits, user verifies on device-controlled UI |
| Sending `eth_sendTransaction` | Phase 4 — not Phase 3 | — | Phase 3 only pairs; Phase 4 wires the request method over the session |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@walletconnect/sign-client` | `^2.23.9` | Dapp-side Sign protocol client; `init`, `connect`, `disconnect`, session storage | The canonical SDK for non-WalletKit (i.e. non-wallet-side) WC v2 integration; Ledger Live speaks the v2 protocol natively |
| `@walletconnect/utils` | `^2.23.9` (transitive via sign-client) | `getSdkError("USER_DISCONNECTED")`, `parseAccountId`, `parseChainId` | Stable error-shape helpers; CAIP-10 parsing without hand-rolling regex on `eip155:1:0x...` |

**Installation:**
```bash
npm install @walletconnect/sign-client@^2.23.9
```

`@walletconnect/utils` and `@walletconnect/types` come transitively — import from them, but do NOT add them to `package.json` (would risk version skew with sign-client).

**Version verification:** `npm view @walletconnect/sign-client version` → `2.23.9` (published 2026-04, ~1 month before this research). [VERIFIED: 2026-05-12]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@walletconnect/sign-client` | `@walletconnect/universal-provider` | Universal Provider wraps Sign + AuthClient + EIP-1193 provider shape — convenient for browser dapps that want `provider.request()` like MetaMask. We're a stdio MCP server, not a browser dapp; the wrapper adds surface we don't use. |
| `@walletconnect/sign-client` | Hand-rolled WC relay client | Hard no — WC's encryption (X25519 + ChaCha20-Poly1305) and JSON-RPC namespacing aren't worth reimplementing. |

## Architecture Patterns

### System Architecture Diagram

```
                    +------------------------+
  pair_ledger_live ─┤ tools/pair_ledger_live ├──┐
                    +------------------------+  │
                                                ▼
                    +-----------------------------------+
                    │ wallet/session-manager            │
                    │  - cachedSession?                 │
                    │  - pair({ force }): Session       │
                    │  - getStatus(): LedgerStatus|null │
                    │  - disconnect(): void             │
                    +-----------------------------------+
                                  │
                                  ▼
                    +-----------------------------------+
                    │ wallet/walletconnect-client       │
                    │  (lazy singleton, mirrors         │
                    │   chains/ethereum.ts pattern)     │
                    │   SignClient.init({               │
                    │     projectId, metadata,          │
                    │     logger: "error",              │
                    │     storageOptions: {             │
                    │       dbName: ":memory:" }})      │
                    +-----------------------------------+
                                  │   HTTPS (WSS upgrade)
                                  ▼
                          +---------------+
                          │  WC v2 relay  │  relay.walletconnect.com
                          +---------------+
                                  │
                                  ▼
                          +---------------+
                          │ Ledger Live   │  user pastes URI here
                          └───────┬───────┘
                                  │ USB
                                  ▼
                          +---------------+
                          │ Ledger device │   <-- ONLY TRUSTED DISPLAY
                          +---------------+
```

**Read this diagram bottom-up for the trust hierarchy**: everything above the Ledger device is "potentially-unreliable component" per CONTEXT.md / PROJECT.md. The session-manager is the seam Phase 4 will hook into to route `eth_sendTransaction` requests.

### Recommended Project Structure

```
src/
├── wallet/                       # NEW in Phase 3
│   ├── walletconnect-client.ts   # lazy singleton SignClient init
│   ├── session-manager.ts        # cached session + pair/getStatus/disconnect API
│   └── caip.ts                   # parseAccountId wrapper (1 file because it's so trivial; could fold into session-manager)
├── tools/
│   ├── pair_ledger_live.ts       # NEW — thin handler over session-manager.pair()
│   ├── get_ledger_status.ts      # NEW — thin handler over session-manager.getStatus()
│   └── register-all.ts           # +2 import lines
└── config/
    └── env.ts                    # +1 accessor: getWalletConnectProjectId()
```

**Why a dedicated `src/wallet/` directory?** The session manager is the thing Phase 4 imports to send transactions; future phases (v2.0 Solana via USB-HID) will add `src/wallet/solana-hid.ts` alongside. A dedicated dir signals "transport-to-signer" as a category distinct from `src/chains/` (read-side RPC clients) and `src/security/` (defense-in-depth blocks, lands in Phase 4+).

### Pattern 1: Lazy-singleton client (mirror of `chains/ethereum.ts`)

**What:** A module-scoped `cachedClient: SignClient | undefined`, an exported `getWalletConnectClient(): Promise<SignClient>`, an exported `_resetClientForTesting()`. The function is `async` (unlike `getEthereumClient`) because `SignClient.init` is async.

**When to use:** Phase 3 plan 03-01. This is the pattern from `src/chains/ethereum.ts:13-33`, adapted for an async init.

**Example:**
```typescript
// Source: pattern from src/chains/ethereum.ts; SignClient API per
// @walletconnect/sign-client v2.23.9 type defs.
import { SignClient } from "@walletconnect/sign-client";
import type { SignClient as SignClientType } from "@walletconnect/sign-client";
import { log } from "../diagnostics/logger.js";
import { getWalletConnectProjectId } from "../config/env.js";

let cachedClient: SignClientType | undefined;
let initInFlight: Promise<SignClientType> | undefined;

const METADATA = {
  name: "VaultPilot MCP",
  description: "Self-custodial DeFi for AI agents",
  url: "https://github.com/szhygulin/vaultpilot-mcp",
  icons: [],   // Ledger Live tolerates empty array; no public-facing icon hosting in v1.x
} as const;

export class MissingProjectIdError extends Error {
  constructor() {
    super(
      "WALLETCONNECT_PROJECT_ID env var is not set. " +
      "Register a project at https://cloud.walletconnect.com to obtain one, then re-run with the env var set.",
    );
    this.name = "MissingProjectIdError";
  }
}

export async function getWalletConnectClient(): Promise<SignClientType> {
  if (cachedClient) return cachedClient;
  if (initInFlight) return initInFlight;          // dedupe concurrent calls

  const projectId = getWalletConnectProjectId();
  if (!projectId) throw new MissingProjectIdError();

  initInFlight = (async () => {
    log("info", "initializing WalletConnect sign-client (in-memory storage)");
    const client = await SignClient.init({
      projectId,
      metadata: METADATA,
      logger: "error",                            // silence pino chattiness; only WC errors hit stderr
      storageOptions: { dbName: ":memory:" },     // critical: no walletconnect.db on disk
    });
    cachedClient = client;
    initInFlight = undefined;
    return client;
  })();
  return initInFlight;
}

export function _resetWalletConnectClientForTesting(): void {
  cachedClient = undefined;
  initInFlight = undefined;
}
```

### Pattern 2: Session manager

**What:** A module that owns the "is there a paired Ledger right now?" question. Wraps the client. Exposes `pair({ force }) → Session`, `getStatus() → LedgerStatus | null`, `disconnect() → void`. Internally caches the session by topic (not by force-of-habit — re-checks the client's session store on every `pair()` call to survive a session expiring between calls).

**When to use:** Phase 3 plan 03-01 (manager) and 03-02 (tools that consume it).

**Example sketch:**
```typescript
// Source: combining IEngine.connect / approve / disconnect signatures from
// @walletconnect/types/dist/types/sign-client/engine.d.ts with the
// SessionTypes.Struct shape from session.d.ts.
import { getSdkError, parseAccountId } from "@walletconnect/utils";
import type { SessionTypes } from "@walletconnect/types";
import { getWalletConnectClient } from "./walletconnect-client.js";

const REQUIRED_NAMESPACES = {
  eip155: {
    chains: ["eip155:1"],                        // Ethereum mainnet only in v1.0
    methods: ["eth_sendTransaction", "personal_sign"],
    events: ["accountsChanged", "chainChanged"],
  },
} as const;

const APPROVAL_TIMEOUT_MS = 60_000;

export interface LedgerStatus {
  paired: true;
  address: `0x${string}`;
  chainId: number;
  sessionTopicLast8: string;
}

export interface PairResult {
  wcUri: string;
  status: LedgerStatus;
}

export async function pair({ force = false }: { force?: boolean } = {}): Promise<PairResult> {
  const client = await getWalletConnectClient();

  // Check existing session first unless caller forced a re-pair.
  if (!force) {
    const existing = findLiveSession(client);
    if (existing) return { wcUri: "", status: sessionToStatus(existing) };
  } else {
    const existing = findLiveSession(client);
    if (existing) {
      await client.disconnect({
        topic: existing.topic,
        reason: getSdkError("USER_DISCONNECTED"),
      });
    }
  }

  const { uri, approval } = await client.connect({ requiredNamespaces: REQUIRED_NAMESPACES });
  if (!uri) throw new Error("WalletConnect returned no URI; relay unreachable?");

  // Race the approval Promise against a 60s budget.
  const session = await Promise.race([
    approval(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ApprovalTimeoutError()), APPROVAL_TIMEOUT_MS),
    ),
  ]);

  return { wcUri: uri, status: sessionToStatus(session) };
}

export async function getStatus(): Promise<LedgerStatus | null> {
  // Lazy: if the client hasn't been init'd yet, no session can exist.
  if (!isClientInitialized()) return null;
  const client = await getWalletConnectClient();
  const live = findLiveSession(client);
  return live ? sessionToStatus(live) : null;
}

function findLiveSession(client: SignClientType): SessionTypes.Struct | undefined {
  const now = Math.floor(Date.now() / 1000);
  return client.session.getAll().find((s) => s.expiry > now);
}

function sessionToStatus(session: SessionTypes.Struct): LedgerStatus {
  const accounts = session.namespaces.eip155?.accounts;
  if (!accounts || accounts.length === 0) {
    throw new Error("paired session has no eip155 accounts; Ledger Live did not approve a wallet");
  }
  // CAIP-10 parse: "eip155:1:0xAbc..." → { chainId: "eip155:1", address: "0xAbc..." }
  const { chainId, address } = parseAccountId(accounts[0]);
  const numericChainId = Number(chainId.split(":")[1]);
  return {
    paired: true,
    address: address as `0x${string}`,
    chainId: numericChainId,
    sessionTopicLast8: session.topic.slice(-8),
  };
}
```

### Anti-Patterns to Avoid

- **Persisting session state to disk.** Default Node storage will write `walletconnect.db` to CWD. We intentionally don't want this — the security model is "fresh process = fresh pair." Pass `storageOptions: { dbName: ":memory:" }`. [VERIFIED: source inspection of `@walletconnect/keyvaluestorage/dist/index.cjs.js`]
- **Using `SignClient.init` from inside a tool handler with no singleton.** Init does a relay handshake (WSS upgrade); doing it per-call adds 500ms-2s of latency to every `pair_ledger_live` invocation and leaks file descriptors. Always go through the lazy singleton.
- **Awaiting `approval()` without a timeout.** WC's built-in timeout (5 minutes) is too long for a tool response budget. Race against 60s per PAIR-01. Reference: [WalletConnect monorepo #5588](https://github.com/WalletConnect/walletconnect-monorepo/issues/5588) — the SDK historically did time out pairing at 5 mins; modern versions still don't surface a configurable client-side timeout, so `Promise.race` is the standard pattern.
- **Splitting the address string with `.slice(9)`.** A widely-copied Medium tutorial does this. It works for `eip155:1:0x...` but breaks for `eip155:137:0x...` (10-char prefix). Use `parseAccountId` from `@walletconnect/utils`. [CITED: Medium WalletConnect Sign v2.0 guide]
- **Surfacing the relay-side error verbatim to the user when they reject in Ledger Live.** The WC error is `{ code: 5000, message: "User rejected." }` — we wrap it as a structured `userRejectedPairing: true` field with a hint to re-call `pair_ledger_live` after retry, so the agent has a routable error shape instead of a free-text error string.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Generating + transporting the pairing handshake | Custom WSS + libsodium client | `@walletconnect/sign-client` | X25519 + ChaCha20-Poly1305 + relay JSON-RPC method namespacing is a multi-month surface; the SDK has years of audit history |
| Parsing CAIP-10 account strings | Regex on `eip155:1:0x...` | `parseAccountId` from `@walletconnect/utils` | Future chains use different chain-id formats; e.g. Solana is `solana:5eykt4...`. Regex breaks silently. |
| WC error codes | Hand-coded constants | `getSdkError("USER_DISCONNECTED")` etc from `@walletconnect/utils` | Spec-tracked; numeric codes have changed across WC versions. |
| Detecting an "active" session | Listen to `session_connect` / `session_delete` events and maintain own map | `signClient.session.getAll().filter(s => s.expiry > now)` | The store is already maintained by the SDK; querying it is the source of truth |
| Approval timeout | Hand-rolled `setTimeout` with manual cancellation | `Promise.race([approval(), timeoutPromise])` with a `.finally(() => clearTimeout(t))` | Standard Node pattern; WC SDK doesn't expose a `connect` timeout option |

**Key insight:** The WC SDK is the heavy lifting. Phase 3's complexity isn't in *speaking* WC — it's in (a) wiring our singleton + manager pattern, (b) handling the 5+ failure modes cleanly, and (c) surfacing the right verbatim text in tool responses so the user can cross-check on-device. The plan tasks should be light on WC plumbing and heavy on response shaping + error-path tests.

## Common Pitfalls

### Pitfall 1: Filesystem persistence pollutes CWD

**What goes wrong:** Without `storageOptions: { dbName: ":memory:" }`, WC's default Node storage creates a `walletconnect.db` file in `process.cwd()` (which, for an MCP server installed via `npx`, is wherever the user happened to invoke their MCP client from).
**Why it happens:** The default `KeyValueStorage` constructor in `@walletconnect/keyvaluestorage` uses `unstorage` with the `fs-lite` driver pointed at `walletconnect.db`. [VERIFIED: source inspection]
**How to avoid:** Always pass `storageOptions: { dbName: ":memory:" }` in `SignClient.init`. The `:memory:` sentinel triggers `unstorage.createStorage()` with no driver — pure in-memory.
**Warning signs:** A `walletconnect.db` file appears in the user's home directory or wherever they launched their MCP client.

### Pitfall 2: Stdout pollution from WC's pino logger

**What goes wrong:** `@walletconnect/logger` exports pino; default pino level writes to stdout. MCP protocol parses stdout — any stray log line crashes the client.
**Why it happens:** WC SDK's default logger setting is `"error"` already in v2.23.9, but the level isn't pinned in our init call.
**How to avoid:** Pass `logger: "error"` (or `"silent"` for full quiet) in `SignClient.init`. Even though "error" is the default, pin it explicitly — the SDK has changed defaults between versions historically.
**Warning signs:** MCP client reports "invalid JSON" or "unexpected token" errors after any pair_ledger_live invocation.

### Pitfall 3: Calling `signClient.connect()` while a pending proposal exists

**What goes wrong:** If a previous `connect()` call's `approval()` is still pending when a new `connect()` is initiated (e.g. user calls `pair_ledger_live` twice quickly), the SDK leaves both proposals open — the user can approve either in Ledger Live and the other times out silently 5 minutes later.
**Why it happens:** No automatic dedup in the SDK.
**How to avoid:** The session manager tracks a single `inFlightApproval: Promise<...> | undefined` field; if it's set, refuse the second `pair()` call with `pairing already in progress; cancel by re-calling with force: true` or by waiting for the first to resolve/timeout.
**Warning signs:** User pastes the first URI into Ledger Live, sees their address, then a second tool call returns a *different* URI — confusing UX.

### Pitfall 4: Session expiry between `pair()` and `getStatus()`

**What goes wrong:** WC v2 sessions have an expiry (default ~7 days, but the spec allows shorter). If `getStatus()` is called after expiry, `session.getAll()` may still return the stale entry depending on cleanup timing.
**Why it happens:** Known SDK issue ([WalletConnect monorepo #4484](https://github.com/WalletConnect/walletconnect-monorepo/issues/4484)) — `getActiveSessions` can return disconnected/expired entries until the expirer fires.
**How to avoid:** Always filter `session.getAll()` results by `s.expiry > nowSeconds()`. Treat the filter as authoritative, not the store.
**Warning signs:** `get_ledger_status` returns `paired: true` but Phase 4 `eth_sendTransaction` calls fail with "no matching topic".

### Pitfall 5: Missing `WALLETCONNECT_PROJECT_ID` discovered at pair time, not init time

**What goes wrong:** Throwing inside the lazy singleton initializer means every Phase 3 / Phase 4 tool call eventually surfaces the same env-var error — but only the first one is informative; the rest are "client not initialized" cryptic.
**How to avoid:** Check `getWalletConnectProjectId()` BEFORE entering the singleton init; throw the `MissingProjectIdError` *before* any state changes. The handler catches it and returns the structured refusal.
**Warning signs:** Confusing error messages on second + subsequent calls after a missing-projectId failure.

## Code Examples

### Tool registration shape (Phase 3 follows the side-effect-import pattern from Phase 2)

```typescript
// src/tools/pair_ledger_live.ts (sketch)
import { pair, ApprovalTimeoutError, UserRejectedPairingError } from "../wallet/session-manager.js";
import { MissingProjectIdError } from "../wallet/walletconnect-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Pair a Ledger hardware wallet via WalletConnect so subsequent prepare_* tools can route unsigned transactions to the device for signing.",
  "Use this once per session BEFORE any prepare_* / send_transaction tool — the trust pipeline cannot operate without a paired Ledger.",
  "DO NOT use this for read-only flows (get_portfolio_summary, get_token_balance, get_transaction_status, resolve_ens_name) — those work without pairing.",
  "Returns `{ wcUri, address, chainId, sessionTopicLast8 }`. The wcUri is what the user pastes into Ledger Live (Settings → WalletConnect → Connect). Tool blocks up to 60s waiting for session approval.",
  "Pass `force: true` to disconnect any existing session and pair from scratch (e.g. after switching accounts in Ledger Live). Without `force`, repeated calls return the cached session immediately.",
  "The response carries a VERIFY-ON-DEVICE block instructing the user to confirm the surfaced address matches Ledger Live → Settings → Connected Apps; this is a tamper signal — if it doesn't match, a MITM may be active.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    force: {
      type: "boolean",
      description: "Disconnect any existing session and re-pair from scratch. Default false (return cached session).",
    },
  },
  additionalProperties: false,
};

registerTool("pair_ledger_live", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // ... handler body wraps pair() with structured error mapping
});
```

### Verbatim VERIFY-ON-DEVICE block (PAIR-03)

```text
VERIFY-ON-DEVICE
  Address: 0xABCDef...
  Session topic (last 8): a1b2c3d4

In Ledger Live → Settings → Connected Apps:
  - Confirm the address shown for this app matches the address above.
  - Confirm the session topic (last 8 hex chars) matches.
  - If either doesn't match, DO NOT proceed with any signing flow.
    Treat it as a tamper signal and re-pair with force: true.
```

## Runtime State Inventory

> Phase 3 is greenfield (no rename/refactor/migration). This section is omitted.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `WALLETCONNECT_PROJECT_ID` env var | Plan 03-01 SignClient.init | Not in CI / dev shells by default | — | **No fallback** — PAIR-04 mandates a clear-error refusal; document in Phase 3 verify-phase prerequisite |
| Network egress to `relay.walletconnect.com` (WSS) | Plan 03-01 runtime | Required at runtime | — | None — server can boot without it; first `pair_ledger_live` will fail with a connectivity error |
| `node` ≥ 18.17 | Already a project requirement | ✓ | per `package.json` engines | — |
| Ledger device + Ledger Live | Phase 3 verify-phase smoke (NOT for unit tests) | User-side only | — | Phase 3 verify-phase is "exercise the real flow"; unit tests fully mock |

**Missing dependencies with no fallback:**
- `WALLETCONNECT_PROJECT_ID` is the load-bearing one. STATE.md already names this as a Phase 3 prerequisite. Register at https://cloud.walletconnect.com before the Phase 3 verify-phase step. Plans should document the registration step in the verify-phase prerequisites.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^2.1.0` (already configured) |
| Config file | None — defaults; tests in `test/` |
| Quick run command | `npm test` (vitest run; ~3-5s for full suite) |
| Full suite command | `npm test` (same — suite is small enough that there's no fast/slow split yet) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAIR-01 | `pair_ledger_live` returns wcUri, waits up to 60s for approval | unit (mocked SignClient) | `npm test -- pair-ledger-live` | ❌ Wave 0 |
| PAIR-01 (timeout branch) | 60s elapses with no approval → structured refusal | unit (fake timers) | `npm test -- pair-ledger-live` | ❌ Wave 0 |
| PAIR-02 | `get_ledger_status` returns `{ paired, address, chainId, sessionTopicLast8 }` after pair | unit (mocked SignClient) | `npm test -- get-ledger-status` | ❌ Wave 0 |
| PAIR-02 (unpaired) | `get_ledger_status` returns `{ paired: false }` (or null) before pair | unit | `npm test -- get-ledger-status` | ❌ Wave 0 |
| PAIR-03 | Pairing response includes verbatim `VERIFY-ON-DEVICE` block | unit (regex assertion on `content[0].text`) | `npm test -- pair-ledger-live` | ❌ Wave 0 |
| PAIR-04 | Missing `WALLETCONNECT_PROJECT_ID` → clear refusal naming the env var + WC dashboard URL | unit (env clear + tool call) | `npm test -- pair-ledger-live` | ❌ Wave 0 |
| PAIR-05 | Second `pair_ledger_live()` without `force` returns cached session | unit (mocked SignClient state) | `npm test -- pair-ledger-live` | ❌ Wave 0 |
| PAIR-05 (force re-pair) | `force: true` disconnects existing + pairs from scratch | unit (assert `disconnect` mock called) | `npm test -- pair-ledger-live` | ❌ Wave 0 |
| DEMO-06 anticipated | `pair_ledger_live` refusal path when `VAULTPILOT_DEMO=true` | unit (env set + tool call) | `npm test -- pair-ledger-live` | ❌ Wave 0 |
| End-to-end real WC flow | Real relay + real Ledger device pairing | manual (verify-phase) | `npm start` + `pair_ledger_live` from Claude Code | ❌ — verify-phase task |

### Sampling Rate

- **Per task commit:** `npm test` (full suite — fast enough)
- **Per wave merge:** `npm test` + `npm run typecheck`
- **Phase gate:** Full suite green + Phase 3 verify-phase manual flow (real Ledger via WC) green

### Wave 0 Gaps

- [ ] `test/wallet-session-manager.test.ts` — covers PAIR-01/02/05 with a mocked `SignClient`
- [ ] `test/pair-ledger-live.test.ts` — covers PAIR-01/03/04/DEMO-06 against the tool handler
- [ ] `test/get-ledger-status.test.ts` — covers PAIR-02 (paired + unpaired branches)
- [ ] `test/walletconnect-client.test.ts` — covers `MissingProjectIdError` + singleton dedup
- [ ] Test helper: a `MockSignClient` factory that lets tests script the `connect/approval/session/disconnect` sequence (one helper, reused by 4 test files)

**Mocking strategy:** vitest module-level mocking via `vi.mock("@walletconnect/sign-client", ...)`. The `MockSignClient` should expose a `_simulateApproval(session)` / `_simulateRejection(error)` / `_simulateTimeout()` API so each test scripts its scenario explicitly — avoids fragile timing.

## Security Domain

### Applicable ASVS Categories (ASVS Level 2 per `.planning/config.json`)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | WC v2 ECDH session + Ledger device-side approval (we don't authenticate the user; the device does) |
| V3 Session Management | yes | Session topic + expiry per WC spec; we cache + filter on expiry, never persist |
| V4 Access Control | n/a | No multi-user surface in MCP server (single-process, stdio per-instance) |
| V5 Input Validation | yes | `pair_ledger_live({ force? })` and `get_ledger_status({})` have minimal inputs; JSON-schema validation at MCP boundary |
| V6 Cryptography | partial | WC SDK does all key exchange + payload encryption (X25519 + ChaCha20-Poly1305); we never touch cryptographic material directly |
| V9 Communications | yes | All WC traffic over WSS to `relay.walletconnect.com`; project ID required (rate-limit gate); TLS by transport |
| V10 Malicious Code | partial | We depend on the WC SDK supply chain (transitive `unstorage`, `idb-keyval`, `@noble/*`); audit the lockfile diff when bumping versions |
| V14 Configuration | yes | `WALLETCONNECT_PROJECT_ID` validation; in-memory storage opt-in; never write WC db to disk |

### Known Threat Patterns for `@walletconnect/sign-client` + Ledger Live

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| WC relay impersonation (compromised DNS / cert) | Spoofing | TLS pinning by transport; relay URL fixed in SDK; project ID gating |
| Peer impersonation (rogue wallet steals URI) | Spoofing | Session-topic cross-check on device (PAIR-02 / PAIR-03 surface the last-8); user verifies in Ledger Live |
| Session-state tamper between processes | Tampering | In-memory storage only; fresh process = fresh pair |
| Stale session reuse (long-lived session attacker recovers) | Repudiation | No persistence — sessions die with the process |
| Pending-proposal leak (double-pair scenario) | Information disclosure | Session manager refuses concurrent `pair()` calls; only one in-flight approval |
| `WALLETCONNECT_PROJECT_ID` exfiltration | Information disclosure | Env var only; never logged; never echoed in tool responses |
| Pino logger leaking to stdout (MCP protocol corruption) | Tampering (protocol) | Pin `logger: "error"` in SignClient.init; stderr-only logging discipline per CLAUDE.md |

### Residual Risks for v1.0 (defer to v1.3 hardening)

- **Compromised MCP omits the `VERIFY-ON-DEVICE` block** — the user has no static rule to fall back on. Mitigated partially because the block is part of the structured response shape (the MCP can't drop it without changing the response contract the agent expects). Fully closed in v1.3 by the companion skill (`vaultpilot-preflight`) per ADR-0003.
- **No second-LLM cross-check on the surfaced address** — a coordinated MCP+agent compromise could substitute an attacker-controlled address. v1.3 `get_verification_artifact` narrows this. v1.0 residual: user MUST cross-check Ledger Live → Connected Apps.

## Project Constraints (from CLAUDE.md)

These directives apply directly to Phase 3 implementation:

- **Stderr for diagnostics, stdout for MCP protocol** — `logger: "error"` in `SignClient.init` is the load-bearing mitigation; without it, pino will write to stdout and break the MCP client.
- **Tool descriptions are agent routing prompts** — `pair_ledger_live` description names WHEN to use (before any prepare_*) and WHEN NOT (read-only flows). Same for `get_ledger_status`.
- **Single-context repo** — no new CLAUDE.md proliferation; Phase 3 lives in the existing `src/wallet/` directory and uses the existing tool-registration pattern.
- **No private key material crosses any boundary** — confirmed for WC v2: the sign-client speaks ECDH-derived session keys only; private signing keys never leave the Ledger device. Phase 3 codebase does not touch any key material.
- **`src/config/contracts.ts`** — not relevant for Phase 3 (no contract addresses involved in pairing). Becomes load-bearing from Phase 6 onward.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAIR-01 | `pair_ledger_live()` initiates WC pairing, returns `wcUri`, waits up to 60s for approval | `IEngine.connect({ requiredNamespaces })` returns `{ uri, approval }`; `Promise.race` with 60s budget; documented in Pattern 2 above |
| PAIR-02 | `get_ledger_status()` returns `{ paired, address, chainId, sessionTopicLast8 }` after pairing | `session.namespaces.eip155.accounts[0]` parsed via `parseAccountId`; `session.topic.slice(-8)`; documented in Pattern 2 |
| PAIR-03 | Pairing response includes `VERIFY-ON-DEVICE` block | Verbatim block format in Code Examples above; emit in `content[0].text` of tool response |
| PAIR-04 | Missing `WALLETCONNECT_PROJECT_ID` → clear refusal naming env var + WC dashboard URL | `MissingProjectIdError` shape documented in Pattern 1; check before singleton init |
| PAIR-05 | Repeated `pair_ledger_live()` reuses session; `force: true` re-pairs | `session.getAll().filter(expiry > now)`; `disconnect({ topic, reason: getSdkError("USER_DISCONNECTED") })`; documented in Pattern 2 |

## Per-plan recommendations

### Plan 03-01 — `@walletconnect/sign-client` integration + session lifecycle

**Files to author:**
- `src/config/env.ts` — add `getWalletConnectProjectId()` (mirror of `getEthereumRpcUrl`)
- `src/wallet/walletconnect-client.ts` — lazy-singleton `SignClient`, `MissingProjectIdError`
- `src/wallet/session-manager.ts` — `pair({ force })`, `getStatus()`, `disconnect()`, `ApprovalTimeoutError`, `UserRejectedPairingError`, `PendingPairingError`
- `src/wallet/caip.ts` (optional — could fold into session-manager) — `parseAccountId` wrapper that returns `{ chainId: number, address: 0x string }`
- `test/wallet-walletconnect-client.test.ts` + `test/wallet-session-manager.test.ts` + test helper `test/helpers/mock-sign-client.ts`

**Critical decisions to lock:**
- `storageOptions: { dbName: ":memory:" }` — non-negotiable
- `logger: "error"` in init — non-negotiable (stdout-pollution risk)
- `metadata` fields — name/description/url/icons; recommend hard-coded in `walletconnect-client.ts` (not env-driven) so the user always sees the same VaultPilot brand in Ledger Live
- The `chainId` returned by `getStatus()` is **numeric** (e.g. `1`), not the CAIP-2 string (`"eip155:1"`). PAIR-02 doesn't specify, but a numeric chainId matches viem's `chain.id` convention used elsewhere in the codebase.

**Out of scope for 03-01:**
- The tools themselves (those are 03-02)
- `eth_sendTransaction` routing (Phase 4)
- Multi-chain (Phase 8 — `requiredNamespaces.eip155.chains` becomes a per-config list)

### Plan 03-02 — `pair_ledger_live` tool + `get_ledger_status` tool + force-re-pair semantics

**Files to author:**
- `src/tools/pair_ledger_live.ts` — registers `pair_ledger_live` via the side-effect-import pattern from Phase 2
- `src/tools/get_ledger_status.ts` — same pattern
- `src/tools/register-all.ts` — add two import lines
- `test/pair-ledger-live.test.ts` + `test/get-ledger-status.test.ts`

**Critical response shape decisions (from PAIR-03):**
- `pair_ledger_live` response `content[0].text` is plain text containing the `VERIFY-ON-DEVICE` block VERBATIM (no formatting tricks; the agent should be able to surface it to the user un-rewritten)
- `pair_ledger_live` response `structuredContent` carries `{ wcUri, address, chainId, sessionTopicLast8 }` for the agent
- `get_ledger_status` response shape: `structuredContent: { paired: false }` OR `structuredContent: { paired: true, address, chainId, sessionTopicLast8 }`. Match this to whatever Phase 4 will need to consume.
- Structured error shape for failures: `{ isError: true, content: [{ type: "text", text: "error: ..." }], structuredContent: { errorCode: "MISSING_PROJECT_ID" | "APPROVAL_TIMEOUT" | "USER_REJECTED" | "DEMO_MODE_REFUSED" | "PAIRING_IN_PROGRESS" } }` — gives the agent a routable code.

**Demo-mode handling (DEMO-06 anticipated):**

Phase 3 lands before Phase 5 demo mode. Recommend reading `VAULTPILOT_DEMO === "true"` directly via a one-line helper in `src/config/env.ts` (matches DEMO-01 spec — literal `"true"` only). When `true`, refuse with `errorCode: "DEMO_MODE_REFUSED"` pointing at the (not-yet-existing) `set_demo_wallet` tool. Phase 5 will replace the env-only predicate with the full demo-state resolution (env > config > auto-detect) without changing the refusal path — the refusal LOOKS the same to the user; only its predicate evolves. This is the minimum scaffolding to avoid retrofitting demo mode through every Phase 3 + Phase 4 tool later.

**Force-re-pair semantics (PAIR-05):**

`force: true` performs the disconnect-existing → connect-new sequence atomically inside the session manager. The handler doesn't expose intermediate state; from the agent's perspective `force: true` is just a slower path that always returns a fresh URI.

**Out of scope for 03-02:**
- `set_demo_wallet` (Phase 5)
- Any `prepare_*` / `send_transaction` tool (Phase 4)
- `get_ledger_device_info` (Phase 5 DIAG-02 — probes the device for app status; different surface)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WalletConnect v1 (`@walletconnect/client`) | WalletConnect v2 (`@walletconnect/sign-client`) | v1 sunset 2023-06-28 | Hard cutover; v1 relays are dead; do NOT consult v1 docs |
| `connect()` returning only a URI string | `connect()` returning `{ uri, approval }` | v2.0 GA | Approval-as-promise is the canonical wait pattern |
| `addEventListener("session_proposal")` style (wallet-side) | Dapp-side uses `approval()` promise; events only for `session_delete` / `session_expire` post-connection | v2.0 GA | Phase 3 doesn't need event listeners; Phase 4 may listen for `session_delete` to invalidate the cached topic |

**Deprecated/outdated:**
- `@walletconnect/client` (v1) — fully sunset; do not adopt
- `@walletconnect/web3wallet` — that's wallet-side (we're dapp-side)
- `@walletconnect/auth-client` — different protocol (SIWE flow); we want sign-client

## Assumptions Log

> Claims tagged `[ASSUMED]` — flag for user confirmation before they become locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Default session expiry is ~7 days when Ledger Live approves | Pitfall 4 | LOW — we filter on `expiry > now()` regardless of the actual value; the constant doesn't matter to correctness |
| A2 | Ledger Live's "Connected Apps" UI shows the last-8 session topic to the user | PAIR-03 verbatim block | MEDIUM — if Ledger Live doesn't surface the topic at all, the cross-check instruction misleads the user. Verify during Phase 3 verify-phase smoke (a real Ledger pairing). Fallback: drop the topic cross-check sentence and only verify the address |
| A3 | The `pendingPairing` state needs an explicit refusal vs. queuing | Pitfall 3 | LOW — if we queue instead of refuse, UX is "second call waits"; not broken, just slower. Refusal is the simpler shape. |
| A4 | `metadata.icons: []` is acceptable to Ledger Live (no icon hosted) | Pattern 1 | LOW — if Ledger Live requires non-empty icons, supply a single 1-pixel data: URL or use the GitHub avatar URL. Verify during Phase 3 verify-phase. |
| A5 | The MCP server's `metadata.url` doesn't need to resolve to a real site for pairing to succeed | Pattern 1 | LOW — WC doesn't validate the URL fetches; Ledger Live shows it as a string. Verify during Phase 3 verify-phase. |

**Confirm during Phase 3 verify-phase:** A2, A4, A5 — all confirmable by a single real pairing against a Ledger device. If any are wrong, the fix is a metadata change in `walletconnect-client.ts`, not a structural change.

## Open Questions

1. **What field does Ledger Live's "Connected Apps" actually surface — full topic, last-8, or just the dapp name?**
   - What we know: The wallet-connect-live-app code shows the dapp's `metadata.name` prominently. The session topic is internal to WC; whether Ledger Live exposes it to the user is not documented.
   - What's unclear: If Ledger Live doesn't show the topic, our `sessionTopicLast8` cross-check is asking the user to verify something they can't see.
   - Recommendation: During Phase 3 verify-phase (a real pair), the user reports what Ledger Live shows. If topic isn't visible, revise the `VERIFY-ON-DEVICE` block to focus only on the address.

2. **Should `get_ledger_status` ever return `paired: false` vs `null`?**
   - What we know: PAIR-02 specifies `paired: true` for the success case. The unpaired case isn't specified.
   - What's unclear: The exact shape — `{ paired: false }` or `null`.
   - Recommendation: Use `structuredContent: { paired: false }` (object form, not null) for symmetry — agents pattern-match on the `paired` boolean. Lock this in plan 03-02.

3. **Does Phase 4 need a `session_delete` listener to invalidate the topic?**
   - What we know: User can disconnect from Ledger Live side without telling us. WC SDK emits `session_delete` on the client.
   - What's unclear: Whether Phase 3 should wire the listener (more state for Phase 3) or Phase 4 should (couples it with the signing flow's failure-mode handling).
   - Recommendation: Wire it in Phase 3 session-manager (one event handler, drops the cached session). Phase 4 then just sees `getStatus() → null` and refuses cleanly. Cleaner separation than retrofitting.

## Sources

### Primary (HIGH confidence)
- `@walletconnect/sign-client@2.23.9` installed type defs at `/tmp/wc-probe/node_modules/@walletconnect/{sign-client,types,utils,keyvaluestorage}/dist/types/` — verified `IEngine.connect`, `SessionTypes.Struct`, `ProposalTypes.RequiredNamespace`, `getSdkError`, `parseAccountId`, storage adapter behavior
- `@walletconnect/keyvaluestorage` `dist/index.cjs.js` source — verified `:memory:` sentinel triggers in-memory mode
- `github.com/LedgerHQ/wallet-connect-live-app/src/data/methods/EIP155Data.methods.ts` — verified supported EIP-155 methods
- Project files: `src/server.ts`, `src/tools/index.ts`, `src/tools/get_portfolio_summary.ts`, `src/chains/ethereum.ts`, `src/diagnostics/logger.ts`, `src/config/env.ts`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/PROJECT.md`, `docs/adr/0001..0003`

### Secondary (MEDIUM confidence)
- [WalletConnect Specs — Namespaces](https://specs.walletconnect.com/2.0/specs/clients/sign/namespaces) — confirms namespace + CAIP-10 shape
- [WalletConnect Sign v2.0 JS Beginner's Guide (Medium)](https://medium.com/walletconnect/walletconnect-sign-v2-0-beginners-guide-for-javascript-developers-c02c02d215c9) — confirms `init({ projectId })` + `connect({ requiredNamespaces })` + `approval()` pattern; verified against the type defs
- [WalletConnect monorepo issue #5588 — Node.js crash](https://github.com/WalletConnect/walletconnect-monorepo/issues/5588) — historical crash bug, fixed in v2.17.4 (we're on 2.23.9, not affected)
- [WalletConnect monorepo issue #4484 — getActiveSessions returns disconnected sessions](https://github.com/WalletConnect/walletconnect-monorepo/issues/4484) — basis for filtering on `expiry > now()`

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Ledger Live's exact "Connected Apps" UI display fields — no authoritative doc; verified during Phase 3 verify-phase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against installed type defs and `npm view`
- Architecture: HIGH — direct mirror of existing Phase 2 patterns (`src/chains/ethereum.ts` lazy singleton)
- Pitfalls: HIGH for #1, #2, #5 (verified by source inspection); MEDIUM for #3, #4 (verified by SDK issues + spec docs)
- API surface: HIGH — every method signature in this doc maps to a real entry in `@walletconnect/types` `engine.d.ts` / `session.d.ts` / `proposal.d.ts`
- Ledger Live UI cross-check details: LOW — flagged as Assumption A2; resolved by real pairing in verify-phase

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days — WC SDK is stable with monthly point releases; major API shape hasn't shifted since 2.0 GA)

## RESEARCH COMPLETE
