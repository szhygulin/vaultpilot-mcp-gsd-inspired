# Phase 3: WalletConnect pairing — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 11 new files (8 source + 1 test helper + 4 test specs; one source file `src/tools/register-all.ts` is a 2-line edit, not a create)
**Analogs found:** 10 / 11 (one file — `src/wallet/caip.ts` — is a trivial wrapper with no direct analog; closest is `src/ens/resolver.ts`'s thin-wrapper shape)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/config/env.ts` (modify, +1 accessor + DEMO helper) | config | env-read | `src/config/env.ts:8-10` (`getEthereumRpcUrl`) | exact (same file, identical shape) |
| `src/wallet/walletconnect-client.ts` | client (lazy singleton) | request-response | `src/chains/ethereum.ts` | exact role; async-init adaptation |
| `src/wallet/session-manager.ts` | service (in-memory cache + lifecycle) | event-driven (`session_delete`) + request-response (`pair`/`getStatus`) | no exact analog (greenfield); closest is `src/pricing/defillama.ts` (module-scoped cache + reset helper) | partial — borrow cache/reset shape only |
| `src/wallet/caip.ts` | utility (thin viem-style wrapper) | transform | `src/ens/resolver.ts:13-29` (thin wrapper exposing a typed surface over a 3rd-party SDK) | partial — wrapper shape only |
| `src/tools/pair_ledger_live.ts` | tool handler | request-response | `src/tools/get_token_balance.ts` (validates inputs, calls a service, formats response) | exact role |
| `src/tools/get_ledger_status.ts` | tool handler | request-response (read) | `src/tools/get_transaction_status.ts` (returns structured status object + text summary) | exact role |
| `src/tools/register-all.ts` (modify, +2 lines) | config (import list) | side-effect | `src/tools/register-all.ts:1-5` (existing pattern) | exact (same file) |
| `test/helpers/mock-sign-client.ts` | test helper | factory | `test/helpers/spawn-server.ts` (in-process factory exporting `Spawned*` interface + close/reset) | role-match (factory shape, no SDK precedent) |
| `test/wallet-walletconnect-client.test.ts` | test | unit (mocked SDK + env mutation) | `test/chains-ethereum.test.ts` (env-save/restore + reset helper + stderr capture) | exact role |
| `test/wallet-session-manager.test.ts` | test | unit (`vi.mock` of WC SDK) | `test/get-portfolio-summary.test.ts` (module-level `vi.mock` with re-bindable per-test state) | exact role |
| `test/pair-ledger-live.test.ts` | test | unit (handler-level) | `test/get-token-balance.test.ts` (`vi.mock` of upstream module + `getRegisteredTool` + `callTool` helper) | exact role |
| `test/get-ledger-status.test.ts` | test | unit (handler-level) | `test/get-transaction-status.test.ts` (mocked client with named methods + `mockRejectedValueOnce` per branch) | exact role |

## Pattern Assignments

### `src/config/env.ts` — `getWalletConnectProjectId()` + `isDemoMode()`

**Analog:** `src/config/env.ts:1-18` (already in this file — extend, don't replace).

**Pattern to mirror — env-accessor shape** (`src/config/env.ts:1-10`):

```typescript
function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getEthereumRpcUrl(): string | undefined {
  return read("ETHEREUM_RPC_URL");
}
```

**To add (mirror `getEthereumRpcUrl` exactly):**

```typescript
export function getWalletConnectProjectId(): string | undefined {
  return read("WALLETCONNECT_PROJECT_ID");
}

// DEMO-01 / DEMO-02: literal "true" only (strict opt-in).
// Note: DEMO-02 says VAULTPILOT_DEMO=false is a deterministic opt-out, so we
// can't just check `=== "true"` — we must also distinguish "false" from "unset"
// when Phase 5 layers in config-file resolution. For Phase 3 the simple
// predicate suffices; Phase 5 replaces this body without changing the signature.
export function isDemoMode(): boolean {
  return process.env.VAULTPILOT_DEMO === "true";
}
```

**Why this shape:** `getEthereumRpcUrl` is the established convention — one function per env var, `read()` does the trim+empty-string normalization. The DEMO accessor returns `boolean` (not `string | undefined`) because DEMO-01 spec is literal-`"true"` only; callers want a predicate, not a string.

---

### `src/wallet/walletconnect-client.ts` (client, request-response)

**Analog:** `src/chains/ethereum.ts` (lines 1-44, full file).

**Imports pattern** (`src/chains/ethereum.ts:1-5`):

```typescript
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

import { getEthereumRpcUrl } from "../config/env.js";
import { log } from "../diagnostics/logger.js";
```

Apply: `.js` extension on relative imports (NodeNext ESM); 3rd-party imports grouped above project imports separated by a blank line; default-import the SDK type alongside the value.

**Lazy-singleton pattern** (`src/chains/ethereum.ts:9-33`):

```typescript
let cachedClient: PublicClient | undefined;
let cachedUsedFallback = false;
let warnedFallback = false;

export function getEthereumClient(): PublicClient {
  if (cachedClient) return cachedClient;

  const override = getEthereumRpcUrl();
  const url = override ?? PUBLICNODE_ETHEREUM_RPC_URL;
  cachedUsedFallback = override === undefined;

  if (cachedUsedFallback && !warnedFallback) {
    log(
      "warn",
      `ETHEREUM_RPC_URL not set — using PublicNode public RPC (${PUBLICNODE_ETHEREUM_RPC_URL}); set ETHEREUM_RPC_URL for production traffic`,
    );
    warnedFallback = true;
  }

  cachedClient = createPublicClient({
    chain: mainnet,
    transport: http(url),
  });
  return cachedClient;
}

export function _resetEthereumClientForTesting(): void {
  cachedClient = undefined;
  cachedUsedFallback = false;
  warnedFallback = false;
}
```

**Adaptation for Phase 3:**
1. `getEthereumClient()` is **sync** (viem's `createPublicClient` is sync). `SignClient.init` is **async** — so add the `initInFlight: Promise<...> | undefined` dedupe field shown in research § Pattern 1.
2. Add `MissingProjectIdError extends Error` — **first custom Error subclass in the codebase** (verified via `grep "class.*Error" src/`; nothing precedent). Keep it minimal: `name`, `message`, no extra fields. Phase 4 may add `cause` / `code` plumbing.
3. `_resetWalletConnectClientForTesting()` clears both `cachedClient` AND `initInFlight` — symmetry with `_resetEthereumClientForTesting`. Add a `_resetForTesting` member alias if test mocks need it.
4. The `warn`-on-fallback pattern doesn't apply — there's no fallback project ID; missing → throw. But there IS a one-shot `log("info", ...)` opportunity on first init (mirrors the research-recommended `log("info", "initializing WalletConnect sign-client (in-memory storage)")`).

**No analog for `MissingProjectIdError`** — this is the first custom Error class. Pattern (from research § Pattern 1, vetted against TS strict-mode + ESM):

```typescript
export class MissingProjectIdError extends Error {
  constructor() {
    super(
      "WALLETCONNECT_PROJECT_ID env var is not set. " +
      "Register a project at https://cloud.walletconnect.com to obtain one, then re-run with the env var set.",
    );
    this.name = "MissingProjectIdError";
  }
}
```

This is the convention going forward — every domain error gets `name = "ClassName"` set explicitly (TS strips it otherwise; test-friendly: `err.name === "MissingProjectIdError"` works as an `instanceof` alternative across module-mock boundaries).

---

### `src/wallet/session-manager.ts` (service, event-driven + request-response)

**Analog (closest):** `src/pricing/defillama.ts` (module-scoped cache + `_resetPriceCacheForTesting`). Borrow the cache/reset shape; the lifecycle methods (`pair`, `getStatus`, `disconnect`) are greenfield.

**Module-scoped state pattern** (`src/pricing/defillama.ts:27-32, 141-144`):

```typescript
interface CacheEntry {
  quote: PriceQuote;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

// ... later ...

/** Test-only: clears the in-memory price cache so the next call refetches. */
export function _resetPriceCacheForTesting(): void {
  cache.clear();
}
```

Apply: a single `let cachedSession: SessionTypes.Struct | undefined`, a single `let inFlightApproval: Promise<...> | undefined` for the pending-proposal dedup (Pitfall 3), a single `_resetSessionManagerForTesting()` that clears both AND clears any registered `session_delete` listener.

**Why not borrow from `src/chains/ethereum.ts`?** Ethereum client is a pure cache (memoize forever). Session manager has lifecycle (TTL via `expiry`, listener-driven invalidation, force-disconnect-and-re-pair). Pricing cache has the closest match because it also has expiry-driven entries — but the session-manager's lifecycle is richer.

**Error-class convention** — borrow from the `MissingProjectIdError` shape above:

```typescript
export class ApprovalTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Ledger Live did not approve the pairing within ${timeoutMs}ms. Re-call pair_ledger_live to retry.`);
    this.name = "ApprovalTimeoutError";
  }
}
export class UserRejectedPairingError extends Error {
  constructor() {
    super("Pairing was rejected from Ledger Live. Re-call pair_ledger_live to retry; ensure your Ledger app is open.");
    this.name = "UserRejectedPairingError";
  }
}
export class PendingPairingError extends Error {
  constructor() {
    super("A pairing approval is already in flight. Wait for it to resolve/timeout, or call pair_ledger_live with { force: true } to cancel and restart.");
    this.name = "PendingPairingError";
  }
}
```

**`session_delete` listener pattern** — no analog (Phase 3 is the first event-driven surface). Wire it inside `getWalletConnectClient()` registration OR inside the session-manager's `pair()` (first time only). Reference research § Open Question #3 — decision is "wire in Phase 3 session-manager". The implementer should choose ONE registration site and make it idempotent (re-registering the same listener twice on `_resetForTesting` → restart cycles is a leak); the `register-once-via-flag` pattern works:

```typescript
let listenerRegistered = false;
async function ensureSessionDeleteListener(): Promise<void> {
  if (listenerRegistered) return;
  const client = await getWalletConnectClient();
  client.on("session_delete", ({ topic }) => {
    if (cachedSession?.topic === topic) cachedSession = undefined;
  });
  listenerRegistered = true;
}
```

`_resetSessionManagerForTesting()` MUST reset `listenerRegistered = false` and remove the listener via `client.off("session_delete", ...)` — otherwise test-suite cross-contamination.

---

### `src/wallet/caip.ts` (utility, transform)

**Analog:** `src/ens/resolver.ts:1-33` — thin wrapper exposing a clean typed surface over a 3rd-party SDK helper.

**Wrapper-with-doc-comments pattern** (`src/ens/resolver.ts:1-33`):

```typescript
import type { Address } from "viem";
import { getEnsAddress, getEnsName, normalize } from "viem/ens";

import { getEthereumClient } from "../chains/ethereum.js";

/**
 * Forward-resolve an ENS name to an address using viem's Universal Resolver.
 * Returns null when the name does not resolve (no records, expired, etc.).
 *
 * Names are normalized via ENSIP-15 (`viem.normalize`) before lookup; an
 * unnormalizable input throws — let the caller surface that as a tool error.
 */
export async function resolveEnsName(name: string): Promise<Address | null> {
  const client = getEthereumClient();
  const normalized = normalize(name);
  return client.getEnsAddress({ name: normalized });
}

// Re-export the viem actions in case downstream callers need the lower-level
// form with custom block tags or coinTypes.
export { getEnsAddress, getEnsName };
```

**Apply for `src/wallet/caip.ts`:**

```typescript
import type { Address } from "viem";
import { parseAccountId } from "@walletconnect/utils";

/**
 * Parse a CAIP-10 account identifier (e.g. `eip155:1:0xAbc...`) into the
 * numeric chain id viem uses elsewhere in the codebase plus the 0x address.
 *
 * Falls through to {@link parseAccountId} from `@walletconnect/utils` for the
 * actual split — that handler is the source of truth across chain-id formats
 * (Solana's `solana:5eykt4...` won't match the eip155-shaped regex, which is
 * exactly why we don't hand-roll the split).
 *
 * Throws if the chain reference is not an integer (would mean a non-eip155
 * namespace was approved; out of scope for v1.0 Ethereum-only).
 */
export function parseEvmAccount(caip10: string): { chainId: number; address: Address } {
  const { chainId, address } = parseAccountId(caip10);
  const [namespace, ref] = chainId.split(":");
  if (namespace !== "eip155") {
    throw new Error(`expected eip155 account, got ${namespace}:${ref}`);
  }
  const numericChainId = Number(ref);
  if (!Number.isInteger(numericChainId)) {
    throw new Error(`invalid chain reference: ${ref}`);
  }
  return { chainId: numericChainId, address: address as Address };
}
```

**No analog for the numeric-chainId convention** — the choice is from research § Per-plan recommendations: numeric matches viem's `chain.id`. Lock this in `caip.ts`'s doc comment so future callers don't reintroduce the CAIP-2 string.

---

### `src/tools/pair_ledger_live.ts` (tool, request-response)

**Analog:** `src/tools/get_token_balance.ts:1-105` (closest because it validates inputs, calls a service, formats both `content` text + `structuredContent`, has a try/catch with structured error message).

**Imports pattern** (`src/tools/get_token_balance.ts:1-4`):

```typescript
import { type Address, erc20Abi, formatUnits, getAddress, isAddress } from "viem";

import { getEthereumClient, isPublicNodeFallback } from "../chains/ethereum.js";
import { registerTool } from "./index.js";
```

**Multi-paragraph description joined by spaces** (`src/tools/get_token_balance.ts:6-11`):

```typescript
const DESCRIPTION = [
  "Read a single ERC-20 token balance for one wallet on Ethereum mainnet, returning the on-chain `balanceOf` result formatted as a decimal string alongside the token's `decimals` and `symbol`.",
  "Use this when the user asks about a specific token by contract address (e.g. \"what's my USDC balance\" once you have the USDC contract address) — NOT for full-portfolio scans (use `get_portfolio_summary` for that) and NOT when you only know the symbol (resolve the contract address first).",
  "USD valuation is OPTIONAL: `balanceUsd` and `priceUnknown` are populated only once the pricing layer is wired; until then both are absent and the response is balance-only.",
  "Decimal strings cross the boundary, never numbers — preserves precision for downstream signing flows.",
].join(" ");
```

Apply: array-of-paragraphs joined by `" "`; first paragraph is the action verb + return-shape; second paragraph is the WHEN-to-use + WHEN-NOT (explicit anti-routing to neighbouring tools); subsequent paragraphs nuance. Research § Code Examples already drafted the `pair_ledger_live` description in this exact shape — use it verbatim (or near-verbatim).

**Input-schema pattern** (`src/tools/get_token_balance.ts:13-29`):

```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description: "Wallet address to query (0x-prefixed, 40 hex chars). Mixed case accepted; checksum is normalized.",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
    // ...
  },
  required: ["wallet", "tokenAddress"],
  additionalProperties: false,
};
```

Apply: `type: "object" as const`, `additionalProperties: false` always (strictness), per-property `description` strings (these surface to the agent — be precise). For `pair_ledger_live`, `force: boolean` is the only property and is NOT in `required`.

**Handler shape — input validation + service call + structured-error wrap** (`src/tools/get_token_balance.ts:40-105`):

```typescript
registerTool("get_token_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  // ... per-arg validation, each returns isError on failure ...
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed Ethereum address" }],
      isError: true,
    };
  }
  // ...
  const wallet: Address = getAddress(walletRaw);
  const client = getEthereumClient();

  try {
    // ... service call ...
    return {
      content: [
        {
          type: "text",
          text: `${wallet} holds ${balance} ${symbol} (token ${tokenAddress}, decimals=${decimals})`,
        },
      ],
      structuredContent: { ...result },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read ERC-20 balance for ${wallet} @ ${tokenAddress}: ${message}`,
        },
      ],
      isError: true,
    };
  }
});
```

**Adaptation for `pair_ledger_live`:**
1. Input validation only on `force` (boolean, optional). Reject non-boolean explicitly: `if (args.force !== undefined && typeof args.force !== "boolean") return { isError: true, ... }`.
2. Demo-mode check **before** any session-manager call — `if (isDemoMode()) return { isError: true, content: [...], structuredContent: { errorCode: "DEMO_MODE_REFUSED" } }`. Phase 5 will widen the predicate; the refusal shape is locked here.
3. **Routable `errorCode`** in `structuredContent` on every error path — research § Per-plan recommendations specifies `"MISSING_PROJECT_ID" | "APPROVAL_TIMEOUT" | "USER_REJECTED" | "DEMO_MODE_REFUSED" | "PAIRING_IN_PROGRESS"`. This is **new** for Phase 3 — read-side tools surface error in free text only (`error: failed to read...`). The signing-flow surface needs routable codes because the agent has to decide between retry, refuse, and re-pair. Lock this convention in for `get_ledger_status` too — it's the precedent for every Phase 4+ tool.
4. **`content[0].text` carries the VERIFY-ON-DEVICE block VERBATIM** (PAIR-03 / research § Code Examples). Per CLAUDE.md "PREPARE RECEIPT block in every prepare_* response — verbatim args. Never elide.": apply the same discipline to VERIFY-ON-DEVICE — the block MUST appear in `content[0].text` so the agent can surface it un-rewritten. Two-part text: a one-line human summary + the verbatim block, joined by `\n\n`. Test must regex-assert the block (`expect(text).toMatch(/VERIFY-ON-DEVICE/)` + the address + `Session topic`).
5. **`structuredContent` carries** `{ wcUri, address, chainId, sessionTopicLast8 }` per PAIR-01 + PAIR-02. Chain id is **numeric** (1, not "eip155:1") per research § Per-plan-recommendations decision.

---

### `src/tools/get_ledger_status.ts` (tool, request-response read)

**Analog:** `src/tools/get_transaction_status.ts:1-124` (closest because it has a `null`-vs-error distinction, a status-enum response shape, and a text+structuredContent return that mirrors the structured object).

**Status-enum response pattern** (`src/tools/get_transaction_status.ts:31-37`):

```typescript
interface TxStatusResult {
  status: "pending" | "success" | "reverted";
  blockNumber?: string;
  gasUsed?: string;
  rpcDegraded?: boolean;
}
```

**Empty-input-schema pattern** — `get_ledger_status` takes no args. Use:

```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};
```

Confirmed valid against the MCP SDK schema by inspection of `src/tools/index.ts:3-8` (`properties` is optional in `ToolInputSchema`, and `additionalProperties` is on the type's catch-all). No existing Phase-2 tool has an empty input — Phase 3 introduces it. The shape is a 1:1 mirror of the JSON-schema "empty object accepted" convention.

**Output shape decision** (research § Open Question #2 — locked):

```typescript
interface LedgerStatusUnpaired {
  paired: false;
}
interface LedgerStatusPaired {
  paired: true;
  address: `0x${string}`;
  chainId: number;
  sessionTopicLast8: string;
}
type LedgerStatusResult = LedgerStatusUnpaired | LedgerStatusPaired;
```

Note: use the **object form** `{ paired: false }` (not `null`) per research recommendation — agents pattern-match on the `paired` discriminant.

**Handler shape — `null`-vs-error pattern** (`src/tools/get_transaction_status.ts:51-124`): the `getStatus(): Promise<LedgerStatus | null>` from session-manager returns `null` for unpaired (the common case, not an error). Pair this with **never** running the SDK-init when nothing has been paired yet (per research Pattern 2 — the `isClientInitialized()` guard avoids a relay round-trip for a status read on an unpaired session).

```typescript
registerTool("get_ledger_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  if (isDemoMode()) {
    return {
      content: [{ type: "text", text: "ledger status: demo mode active (no real pairing)" }],
      structuredContent: { paired: false, demoMode: true } as const,
    };
  }
  try {
    const status = await getStatus();
    if (status === null) {
      return {
        content: [{ type: "text", text: "ledger status: not paired. Call pair_ledger_live to pair." }],
        structuredContent: { paired: false } as const,
      };
    }
    return {
      content: [{
        type: "text",
        text: `ledger status: paired with ${status.address} on chain ${status.chainId} (session topic ${status.sessionTopicLast8})`,
      }],
      structuredContent: status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `error: failed to read ledger status: ${message}` }],
      isError: true,
      structuredContent: { errorCode: "STATUS_READ_FAILED" },
    };
  }
});
```

**Why no error code for the unpaired case?** Same logic as `get_transaction_status` returning `pending` — "not paired" is a valid state, not an error. Routable `errorCode` is reserved for handler failures the agent needs to react to.

---

### `src/tools/register-all.ts` (config, side-effect import list)

**Analog:** `src/tools/register-all.ts:1-9` (same file — extend by 2 lines).

**Existing pattern** (`src/tools/register-all.ts:1-9`):

```typescript
import "./resolve_ens_name.js";
import "./reverse_resolve_ens.js";
import "./get_token_balance.js";
import "./get_transaction_status.js";
import "./get_portfolio_summary.js";

export function registerAllTools(): void {
  // Tool modules register on import. Phase 2+ adds imports above this comment.
}
```

**Apply:** Add `import "./pair_ledger_live.js";` and `import "./get_ledger_status.js";` to the import list. The existing comment ("Phase 2+ adds imports above this comment") is load-bearing — preserve it. No reordering of existing imports.

---

### `test/helpers/mock-sign-client.ts` (test helper, factory)

**Analog (role only):** `test/helpers/spawn-server.ts:1-30` — the only existing test helper. It's an in-process factory exporting a `Spawned*` interface + a `close` async cleanup.

**Factory + interface pattern** (`test/helpers/spawn-server.ts:6-30`):

```typescript
export interface SpawnedServer {
  client: Client;
  close: () => Promise<void>;
}

export async function spawnServerInProcess(): Promise<SpawnedServer> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // ...
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
```

**Apply:** Export a `MockSignClient` factory function returning a `{ client, _simulateApproval, _simulateRejection, _simulateTimeout, _emitSessionDelete }` shape. The underscored methods are the "script the scenario" handles research § Wave 0 Gaps named explicitly. Suggested skeleton:

```typescript
import { vi } from "vitest";
import type { SessionTypes } from "@walletconnect/types";

export interface MockSignClient {
  // The actual mock object passed to `vi.mock("@walletconnect/sign-client", ...)`.
  client: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    session: { getAll: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  // Scenario controls — set BEFORE calling pair().
  _simulateApproval: (session: SessionTypes.Struct) => void;
  _simulateRejection: (err: Error) => void;
  _simulateTimeout: () => void;
  _emitSessionDelete: (topic: string) => void;
  // Default fixture used by happy-path tests.
  _defaultSession: (overrides?: Partial<SessionTypes.Struct>) => SessionTypes.Struct;
}

export function createMockSignClient(): MockSignClient { /* ... */ }
```

Avoid a `close()` method — these mocks are reset per test via `beforeEach`, not lifecycle-managed. The shape diverges from `spawn-server.ts` on cleanup only because the underlying resource (a `vi.fn`) doesn't need explicit teardown.

---

### `test/wallet-walletconnect-client.test.ts` (test, env-mutation + SDK mock)

**Analog:** `test/chains-ethereum.test.ts:1-87` (closest because it does env-save/restore around the env-driven singleton + stderr capture).

**Env-save/restore + reset pattern** (`test/chains-ethereum.test.ts:1-43`):

```typescript
const ENV_KEY = "ETHEREUM_RPC_URL";
let savedEnv: string | undefined;
let stderrBuf: string;
let originalStderrWrite: typeof process.stderr.write;

function captureStderr(): void {
  stderrBuf = "";
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBuf += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stderr.write;
}

function restoreStderr(): void {
  process.stderr.write = originalStderrWrite;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
  _resetEthereumClientForTesting();
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  if (savedEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedEnv;
  }
  _resetEthereumClientForTesting();
});
```

**Apply:** Same skeleton with `ENV_KEY = "WALLETCONNECT_PROJECT_ID"`. The stderr capture isn't strictly needed (no fallback warning in WC singleton) — drop it unless asserting the `log("info", "initializing WalletConnect...")` line. Lean toward keeping it; one-shot init log is testable.

**Adaptation:** Module-mock `@walletconnect/sign-client` via `vi.mock(...)` (research § Validation Architecture). Test cases:
- `getWalletConnectClient()` throws `MissingProjectIdError` when env unset
- Second call returns same instance (memoization)
- Concurrent calls share `initInFlight` (one `SignClient.init` call total)
- `_resetWalletConnectClientForTesting()` clears both `cachedClient` AND `initInFlight`

---

### `test/wallet-session-manager.test.ts` (test, complex mocking)

**Analog:** `test/get-portfolio-summary.test.ts:1-80` (re-bindable per-test mock state at module scope).

**Re-bindable mock state pattern** (`test/get-portfolio-summary.test.ts:5-21`):

```typescript
// Mock the ethereum client BEFORE importing anything that resolves it.
// Holders for the per-test mock implementations — re-bound in each test.
let nativeBalance: bigint = 0n;
let nativeBalanceShouldThrow: Error | undefined;

vi.mock("../src/chains/ethereum.js", () => {
  return {
    getEthereumClient: () => ({
      getBalance: vi.fn(async () => {
        if (nativeBalanceShouldThrow) throw nativeBalanceShouldThrow;
        return nativeBalance;
      }),
    }),
    isPublicNodeFallback: () => true,
    _resetEthereumClientForTesting: () => {},
    PUBLICNODE_ETHEREUM_RPC_URL: "https://test.invalid",
  };
});
```

**Apply:** Mock both `@walletconnect/sign-client` AND `../src/wallet/walletconnect-client.js`. The latter gives the session-manager a controllable singleton; the former is for direct SDK-shape tests. Use the `MockSignClient` helper from `test/helpers/mock-sign-client.ts` to script scenarios.

**Fake-timer pattern for 60s timeout** — not present in any existing test. Use vitest's `vi.useFakeTimers()` / `vi.advanceTimersByTime(60_000)` per its standard docs. Confirm `Promise.race`'s `setTimeout`-based reject fires under fake timers by `await vi.advanceTimersByTimeAsync(60_000)` (the async variant lets pending promises flush).

---

### `test/pair-ledger-live.test.ts` (test, handler-level)

**Analog:** `test/get-token-balance.test.ts:1-118` (handler-level: mock upstream module, import `register-all` to register the tool, fetch via `getRegisteredTool`, call via `tool.handler(args)`).

**Handler-level test pattern** (`test/get-token-balance.test.ts:3-12, 38-46`):

```typescript
vi.mock("../src/chains/ethereum.js", () => {
  const client = {
    readContract: vi.fn(),
  };
  return {
    getEthereumClient: () => client,
    isPublicNodeFallback: () => true,
    __client: client,
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

// ... later ...

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_token_balance");
  if (!tool) throw new Error("get_token_balance not registered");
  return tool.handler(args);
}
```

**Apply:**
- `vi.mock("../src/wallet/session-manager.js", ...)` exposing controllable `pair` / `getStatus` mocks
- `vi.mock("../src/wallet/walletconnect-client.js", ...)` exposing the `MissingProjectIdError` class
- `import "../src/tools/register-all.js"` after the mocks — triggers registration under the mock
- `callTool("pair_ledger_live", args)` helper

**Test cases per research § Phase Requirements → Test Map:**
- PAIR-01 happy path: mocked `pair()` resolves → assert `structuredContent` shape + `content[0].text` regex on `/VERIFY-ON-DEVICE/`
- PAIR-01 timeout: mocked `pair()` rejects with `ApprovalTimeoutError` → `errorCode: "APPROVAL_TIMEOUT"`
- PAIR-03: regex-assert the full VERIFY-ON-DEVICE block (address + last-8 + the `In Ledger Live →` literal). Per CLAUDE.md string-template-test rule, use `\s+` between multi-word literals.
- PAIR-04: `MissingProjectIdError` propagation → `errorCode: "MISSING_PROJECT_ID"`
- PAIR-05 default: second call without force → assert `pair` mock called with `{ force: false }` or equivalent
- PAIR-05 force: `args.force = true` → assert `pair` called with `{ force: true }`
- DEMO-06: `process.env.VAULTPILOT_DEMO = "true"` → `errorCode: "DEMO_MODE_REFUSED"` BEFORE any session-manager call (`pair` mock NOT called)

**Env-save/restore for DEMO test** — borrow the pattern from `test/chains-ethereum.test.ts:28-43` (above). Same shape: save in `beforeEach`, restore in `afterEach`.

---

### `test/get-ledger-status.test.ts` (test, handler-level read)

**Analog:** `test/get-transaction-status.test.ts:1-122` (handler-level read with mocked client returning named method mocks).

**Named-method mock pattern** (`test/get-transaction-status.test.ts:4-29`):

```typescript
vi.mock("../src/chains/ethereum.js", () => {
  const client = {
    getTransactionReceipt: vi.fn(),
    getTransaction: vi.fn(),
  };
  return {
    getEthereumClient: () => client,
    isPublicNodeFallback: () => false,
    __client: client,
  };
});

// ... later ...

const mod = (await import("../src/chains/ethereum.js")) as unknown as {
  __client: {
    getTransactionReceipt: ReturnType<typeof vi.fn>;
    getTransaction: ReturnType<typeof vi.fn>;
  };
};
const stubClient = mod.__client;
```

The `__client` re-export trick lets the test grab the SAME mock object the production code resolves — `mockResolvedValueOnce` / `mockRejectedValueOnce` work as expected. Use the same trick for `../src/wallet/session-manager.js` exposing `getStatus`.

**Test cases:**
- Paired: `getStatus` mock resolves to a `LedgerStatusPaired` → assert structured shape
- Unpaired: `getStatus` mock resolves to `null` → assert `{ paired: false }`
- Error: `getStatus` mock rejects → `isError: true`, `errorCode: "STATUS_READ_FAILED"`
- Demo mode: env set → `{ paired: false, demoMode: true }` returned WITHOUT calling `getStatus` mock

## Shared Patterns

### Logging (stderr-only)

**Source:** `src/diagnostics/logger.ts:1-5`
**Apply to:** Every Phase 3 source file that needs diagnostics — `walletconnect-client.ts` (init info line), `session-manager.ts` (session events, timeout warnings)

```typescript
import { log } from "../diagnostics/logger.js";
log("info", "initializing WalletConnect sign-client (in-memory storage)");
```

**Load-bearing rule from CLAUDE.md:** "Stderr for diagnostics, stdout for MCP protocol." Pino's default level in `SignClient.init` is `"error"` — pin it explicitly anyway (research § Pitfall 2). Never `console.log` anywhere in this codebase; the linter doesn't catch it.

### Error-class convention

**Source:** new in Phase 3 (no precedent in codebase — verified)
**Apply to:** All custom errors in `src/wallet/`

Every domain error subclasses `Error` and sets `name = "ClassName"` in the constructor. No `code` / `cause` / `data` fields in Phase 3 — keep the surface minimal. Phase 4 may need richer error shapes for the signing-flow gates, but that's a Phase 4 decision.

### Structured error response shape

**Source:** new in Phase 3 (no precedent — Phase 2 tools return free-text errors only)
**Apply to:** All Phase 3 tool handlers; lock this convention forward for Phase 4+.

```typescript
return {
  content: [{ type: "text", text: "error: <human-readable>" }],
  isError: true,
  structuredContent: { errorCode: "MISSING_PROJECT_ID" /* | ... */ },
};
```

**Routable error codes for Phase 3:**
- `MISSING_PROJECT_ID` — env var unset (PAIR-04)
- `APPROVAL_TIMEOUT` — 60s elapsed with no Ledger Live response (PAIR-01)
- `USER_REJECTED` — user clicked Reject in Ledger Live
- `DEMO_MODE_REFUSED` — `VAULTPILOT_DEMO=true` active (DEMO-06)
- `PAIRING_IN_PROGRESS` — second `pair()` while first still pending
- `STATUS_READ_FAILED` — `get_ledger_status` SDK-level failure

### Input validation pattern

**Source:** `src/tools/get_token_balance.ts:41-57`
**Apply to:** `pair_ledger_live` (boolean `force`), `get_ledger_status` (no args)

```typescript
if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
  return {
    content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed Ethereum address" }],
    isError: true,
  };
}
```

For `force`: `if (args.force !== undefined && typeof args.force !== "boolean")` → reject. The JSON-schema validation at the MCP boundary is the first line; this is defense-in-depth for callers that bypass schema validation.

### Tool-handler return shape

**Source:** `src/tools/index.ts:14-19` (the canonical type)
**Apply to:** All Phase 3 tool handlers — verified by reading `ToolHandlerResult`:

```typescript
export interface ToolHandlerResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}
```

Always include both `content` (human-readable) AND `structuredContent` (machine-readable, agent routes on it). On error, both should still be populated (error code in `structuredContent`, error text in `content`).

### Test mock setup

**Source:** `test/get-token-balance.test.ts:3-12` + `test/get-portfolio-summary.test.ts:9-21`
**Apply to:** All Phase 3 unit tests

- `vi.mock(...)` calls are hoisted by vitest — declare BEFORE imports of the module under test
- Re-export mock internals via `__client` (single-instance) or per-test re-bindable variables (multi-state)
- `import "../src/tools/register-all.js"` AFTER the mock declarations to trigger tool registration under the mock
- Use `_reset*ForTesting()` exports for cache/singleton state; vitest's `beforeEach` resets per-test state

### Side-effect-import tool registration

**Source:** `src/tools/register-all.ts:1-5` (existing list)
**Apply to:** `pair_ledger_live.ts` and `get_ledger_status.ts` — each calls `registerTool(...)` at module top level; `register-all.ts` adds one `import "./<name>.js"` line per tool.

CLAUDE.md / CONTEXT.md naming: "This avoids a central registry-of-registries that would be the merge-conflict surface for parallel agents."

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| Custom `Error` subclasses (in `walletconnect-client.ts`, `session-manager.ts`) | error model | **First custom Error classes in the codebase** — verified via `grep "class.*Error" src/`. Pattern adopted from research § Pattern 1; lock the `name = "ClassName"` discipline as the project convention going forward. |
| Event-listener registration (`session_delete`) in `session-manager.ts` | event-driven | **First event-driven surface in the codebase** — viem/RPC client is purely request-response; pricing cache is timer-driven. The `register-once-via-flag` shape proposed in the assignment above has no codebase precedent; it's the simplest correct pattern. Phase 4 will refine if `payment_method` / `chain_changed` listeners join. |
| `MockSignClient` test helper with scenario-control API (`_simulateApproval`, `_simulateRejection`) | test helper | **First scenario-scripted SDK mock** — existing tests inline-mock per-file (e.g. `nativeBalance` / `nativeBalanceShouldThrow` re-bindables). The session-manager test surface is rich enough (4+ branches per `pair()` call: success, timeout, rejection, pending-conflict, session-delete-mid-pair) to justify a reusable helper. Shape borrowed from `spawn-server.ts`'s factory convention. |
| Fake-timer test for 60s timeout | test pattern | **First use of `vi.useFakeTimers()`** — verified by `grep -rn 'useFakeTimers\|advanceTimers' test/` returning nothing. Use vitest's documented `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(60_000)`; `await` the advance variant so the `setTimeout`-based `Promise.race` reject flushes. |
| Demo-mode predicate (`isDemoMode()`) | config helper | **First demo-mode code in the codebase** — Phase 5 lands the full env > config > auto-detect resolution; Phase 3 ships the minimum-viable predicate (`process.env.VAULTPILOT_DEMO === "true"`) so the refusal path can be wired now and the predicate's body widened in Phase 5 without changing call sites. Document this in the function's JSDoc explicitly so Phase 5's plan finds it. |

## Metadata

**Analog search scope:**
- `src/chains/` (RPC client patterns)
- `src/config/` (env accessors)
- `src/tools/` (tool registration, handler shapes)
- `src/diagnostics/` (logging)
- `src/ens/` (thin SDK wrappers)
- `src/pricing/` (cached service with reset helper)
- `test/` (test conventions, mock shapes)
- `test/helpers/` (factory shape)

**Files scanned:** 17 source files + 9 test files + 3 ADRs (header glance).

**Confidence:**
- Tool / config / test patterns: HIGH — direct mirror of established Phase 2 conventions; multiple analogs converged on the same shape.
- Singleton-with-async-init: HIGH — the sync version (`getEthereumClient`) is a clean structural analog; the async adaptation is standard.
- Error-class convention: MEDIUM — no precedent in codebase, but the pattern is canonical TypeScript; Phase 4 may want to enrich with `code`/`cause`.
- Event-listener registration site: MEDIUM — pattern is correct, but the choice between registering inside `getWalletConnectClient` vs `session-manager.pair` is left to the implementer; both are defensible.
- Fake-timer test pattern: MEDIUM — no codebase precedent; vitest docs are unambiguous, so risk is low.

**Pattern extraction date:** 2026-05-12

## PATTERN MAPPING COMPLETE
