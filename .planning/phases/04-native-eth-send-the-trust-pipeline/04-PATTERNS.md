# Phase 4: Native ETH send (the trust pipeline) — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 22 new files + 2 extensions (10 new source + 8 new test + 1 test-helper, plus extensions to `src/tools/register-all.ts`, `src/wallet/session-manager.ts`, and `test/helpers/mock-sign-client.ts`)
**Analogs found:** 19 / 22 (three files are first-of-their-kind — see § No Analog Found)

## Executive Summary

Phase 4 introduces the `src/signing/` directory — five new infrastructure modules + four new MCP tools + four locked block templates. Most of the work mirrors patterns Phase 3 already cemented:

- **Side-effect-import tool registration** — exact mirror of `src/tools/pair_ledger_live.ts`. Each new tool is a module-top-level `registerTool(...)` call; `register-all.ts` gains one import line per tool.
- **Format-fanout-sentinel block constants** — exact mirror of `VERIFY_ON_DEVICE_TEMPLATE` (`src/tools/pair_ledger_live.ts:51-61`). `src/signing/blocks.ts` ships four exported `string` consts; tests import and substitute the same way handlers do.
- **Custom Error subclasses with `.name = "ClassName"`** — exact mirror of `MissingProjectIdError` / `ApprovalTimeoutError` from Phase 3. Domain errors stay minimal; the `errorCode` envelope is built in the tool handler, not the error class.
- **Routable `errorCode` envelopes** — exact mirror of the Phase 3 locked-five (`MISSING_PROJECT_ID` / `APPROVAL_TIMEOUT` / `USER_REJECTED` / `DEMO_MODE_REFUSED` / `PAIRING_IN_PROGRESS`). Phase 4 adds eleven more codes, all in the same envelope shape.
- **Lazy module-scoped cache + `_reset*ForTesting()`** — borrow from `src/pricing/defillama.ts:32` (`cache = new Map`) + `src/wallet/session-manager.ts:106-109` (multi-field reset).
- **Mocked-singleton test pattern** — borrow from `test/get-token-balance.test.ts` (`__client` export trick) + `test/wallet-session-manager.test.ts` (re-bindable mock at module scope).

Three patterns are genuinely new in Phase 4 and must be locked here so later phases don't accidentally restyle them: (1) the `enum: ["send", "cancel"]` schema-level gate on `userDecision` (the FIRST hard `enum` constraint anywhere in the project's MCP schemas), (2) the in-memory handle store as a monotonic state machine with lazy TTL eviction (`src/signing/handle-store.ts`), and (3) fixture-anchored crypto tests (the `test/signing-fingerprint.test.ts` + `test/signing-presign-hash.test.ts` pair, which lock keccak preimages and EIP-1559 serializations against hardcoded byte strings the research already computed).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/signing/handle-store.ts` | signing-store (in-memory cache + state machine + TTL) | request-response | `src/pricing/defillama.ts:27-32, 141-144` (module-scoped Map + reset helper) | partial — borrow cache shape; state-machine + TTL are greenfield |
| `src/signing/payload-fingerprint.ts` | signing-primitive (pure crypto fn) | transform | `src/ens/resolver.ts:1-33` (thin wrapper over a 3rd-party SDK) | partial — wrapper shape; no codebase crypto-fn precedent |
| `src/signing/presign-hash.ts` | signing-primitive (pure crypto fn) | transform | `src/signing/payload-fingerprint.ts` (sibling — same shape applies) | partial — same as above |
| `src/signing/blocks.ts` | signing-block-template (frozen string consts) | constants | `src/tools/pair_ledger_live.ts:51-61` (`VERIFY_ON_DEVICE_TEMPLATE`) | exact (same file shape; same `.replace` substitution rule) |
| `src/signing/error-codes.ts` | signing-error (typed enum/union) | constants | none — first typed errorCode catalog in the codebase | no-analog — see § No Analog Found |
| `src/clients/fourbyte.ts` | http-client (best-effort + LRU + AbortController) | request-response (HTTP) | `src/pricing/defillama.ts:52-138` (HTTP fetch + in-memory cache + `log("warn", ...)` on failure) | exact role; new AbortController dimension |
| `src/tools/prepare_native_send.ts` | tool (signing — request-response) | request-response | `src/tools/pair_ledger_live.ts` (isDemoMode-first + try/catch ladder + structured errorCode + format-fanout block emission) | exact |
| `src/tools/preview_send.ts` | tool (signing — request-response) | request-response | `src/tools/pair_ledger_live.ts` + `src/tools/get_token_balance.ts:60-78` (parallel viem reads) | exact (composes both) |
| `src/tools/send_transaction.ts` | tool (signing — request-response) | request-response | `src/tools/pair_ledger_live.ts` (try/catch ladder + WC error mapping) | exact |
| `src/tools/get_tx_verification.ts` | tool (signing — read-only) | request-response | `src/tools/get_ledger_status.ts` (read-only, never errors on missing state) | exact |
| `src/tools/register-all.ts` (extend +4 lines) | config (import list) | side-effect | `src/tools/register-all.ts:1-7` (existing pattern — six imports already) | exact (same file) |
| `src/wallet/session-manager.ts` (extend +1 export) | service (lifecycle) | request-response | `src/wallet/session-manager.ts:233-239` (`findLiveSession` is the upstream helper to reuse) | exact (same file) |
| `test/helpers/mock-public-client.ts` | test-helper (factory) | factory | `test/helpers/mock-sign-client.ts` (factory + `_simulate*` / `_set*` driver methods) | exact role |
| `test/helpers/mock-sign-client.ts` (extend) | test-helper (factory extension) | factory | same file (extend; do not re-shape) | exact (own analog) |
| `test/signing-fingerprint.test.ts` | test (unit — fixture-anchored crypto) | unit | none — first fixture-anchored crypto suite | no-analog — see § No Analog Found |
| `test/signing-presign-hash.test.ts` | test (unit — fixture-anchored crypto + round-trip) | unit | `test/signing-fingerprint.test.ts` (sibling once landed) | partial — same shape |
| `test/signing-handle-store.test.ts` | test (unit — state machine + fake timers) | unit | `test/wallet-session-manager.test.ts` (fake-timer + reset helpers) | role-match |
| `test/signing-blocks.test.ts` | test (unit — string-const sanity) | unit | (none — usually folded into tool tests, but Phase 4 splits per § No Analog Found note 3) | partial |
| `test/prepare-native-send.test.ts` | test (unit — handler-level mocked viem) | unit | `test/get-token-balance.test.ts` (mock viem `__client`, register-all, `getRegisteredTool`, `callTool`) | exact |
| `test/preview-send.test.ts` | test (unit — handler-level mocked viem + handle store) | unit | `test/get-token-balance.test.ts` + `test/get-portfolio-summary.test.ts` (multiple mocked modules + per-test re-bind) | exact |
| `test/send-transaction.test.ts` | test (unit — handler-level mocked WC + handle store) | unit | `test/pair-ledger-live.test.ts` (mock session-manager via `vi.importActual` overlay + four errorCode mappings) | exact |
| `test/get-tx-verification.test.ts` | test (unit — handler-level + fake timers for TTL) | unit | `test/get-ledger-status.test.ts` (no-error read path) + `test/wallet-session-manager.test.ts` (fake timers) | role-match |
| `test/fourbyte.test.ts` | test (unit — fetch mocked + AbortController) | unit | `test/pricing-defillama.test.ts` (mocked `fetch` global + cache assertions); confirmed by Phase 2 file listing | exact role |
| `test/trust-pipeline.integration.test.ts` | test (integration — full flow composing two helpers) | integration | none — first integration test composing mock-public-client + mock-sign-client | no-analog — see § No Analog Found |

## Pattern Assignments

### `src/signing/handle-store.ts` (signing-store, request-response)

**Analog:** `src/pricing/defillama.ts:27-32, 141-144` (module-scoped Map + `_resetForTesting`). Secondary: `src/wallet/session-manager.ts:106-109` (multiple module-scoped state fields cleared by one reset helper).

**Imports pattern** (mirror `src/wallet/session-manager.ts:23-31`):

```typescript
import type { Address, Hex } from "viem";
```

Apply: `.js` extension on relative imports (NodeNext ESM); 3rd-party type-only imports use `import type { ... }`. The store has no runtime dependencies — pure data + branded types.

**Module-scoped Map + reset helper pattern** (`src/pricing/defillama.ts:27-32, 141-144`):

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

Apply directly. Replace `CacheEntry` with `HandleRecord` (defined in research § Pattern 1, lines 191-275). The reset helper clears the Map and returns void.

**Lazy-eviction-on-access pattern** (no codebase analog — closest is `src/wallet/session-manager.ts:233-239` filtering by `expiry > now`):

```typescript
// from src/wallet/session-manager.ts:233-239:
function findLiveSession(client: WalletConnectClient): SessionTypes.Struct | undefined {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return client.session.getAll().find((s) => s.expiry > nowSeconds);
}
```

Apply the same `Date.now()`-as-time-source rule (ms here, not seconds). Research § Pattern 1 has the full sketch (`lookup()` deletes on expired). No `setInterval` sweep — vitest fake-timers complicate unref'd timers; lazy eviction has the same correctness.

**Discriminated-union result pattern** (new in Phase 4 — closest analog is `LookupResult` in research § Pattern 1):

```typescript
export type LookupResult =
  | { ok: true; record: HandleRecord }
  | { ok: false; errorCode: "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED" };
```

The errorCode strings cross-reference `src/signing/error-codes.ts` (the union there is the SOT; this file's literal-types narrow to a subset). Future-proof: when Phase 6 adds new transition states (e.g. for typed-data signing flows), extend `error-codes.ts` first, then narrow here.

**Done criteria:**
- `store = new Map<string, HandleRecord>()` at module scope.
- `createHandle({ args, tx, payloadFingerprint }): string` returns a `crypto.randomUUID()`, sets `status: "prepared"`, `createdAt: Date.now()`.
- `lookup(handle): LookupResult` checks `Date.now() > record.createdAt + HANDLE_TTL_MS`, deletes-then-returns-`HANDLE_EXPIRED` on stale.
- `transitionToPreviewed(handle, pinned)` + `transitionToSent(handle, txHash)` return `TransitionResult` (extended union with `WRONG_STATUS`).
- `_resetHandleStoreForTesting(): void` clears the Map.
- Export `HANDLE_TTL_MS = 15 * 60 * 1000`.

---

### `src/signing/payload-fingerprint.ts` (signing-primitive, transform)

**Analog (role only):** `src/ens/resolver.ts:1-33` — thin wrapper over a 3rd-party SDK exposing a clean typed surface with doc comments.

**Imports pattern** (mirror `src/chains/ethereum.ts:1-2` for viem primitives):

```typescript
// src/chains/ethereum.ts:1-2
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
```

Apply to fingerprint:

```typescript
import { keccak256, numberToBytes, hexToBytes, toBytes, concat } from "viem";
import type { Address, Hex } from "viem";
```

The five viem named imports come from research § Code Example 1 with verified type-def citations. Group all-from-viem on one line; the type-only `import type` on a second line.

**Core pattern** — research § Code Example 1 (line 506-543) ships the verbatim implementation. Key invariants:

```typescript
const DOMAIN_TAG = "VaultPilot-txverify-v1:";  // 23 bytes UTF-8 — DO NOT change

export function computePayloadFingerprint(input: {
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
}): Hex {
  const tag = toBytes(DOMAIN_TAG);                          // 23 bytes utf-8
  const chainIdBytes = numberToBytes(input.chainId, { size: 32 });
  const toBytes20 = hexToBytes(input.to);                   // 20 bytes
  const valueBytes = numberToBytes(input.valueWei, { size: 32 });
  const dataBytes = hexToBytes(input.data);                 // 0 bytes when data === "0x"
  const preimage = concat([tag, chainIdBytes, toBytes20, valueBytes, dataBytes]);
  return keccak256(preimage);
}
```

**Verified test fixture (research § Code Example 1 line 547-560):**
- `{ chainId: 1, to: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, valueWei: 1_000_000_000_000_000_000n, data: "0x" }` → `0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a`

**Error handling pattern:** none — pure function. viem's `hexToBytes(non-hex)` throws; let it propagate. Caller is responsible for shape validation.

**Done criteria:**
- Exports `computePayloadFingerprint(input): Hex` as the primary function.
- Exports `FINGERPRINT_DOMAIN_TAG: string` (the 23-byte UTF-8 string `"VaultPilot-txverify-v1:"`) as a `const` so the test in `test/signing-fingerprint.test.ts` can lock the byte length (`FINGERPRINT_DOMAIN_TAG.length === 23`) as a regression anchor against accidental drift in the tag string. The fixture preimage is the primary lock; the tag-length test is defense in depth.
- Module is side-effect-free: no `log`, no `process.env`, no Map.

---

### `src/signing/presign-hash.ts` (signing-primitive, transform)

**Analog:** `src/signing/payload-fingerprint.ts` (sibling). Same shape: pure-function wrapper around viem primitives.

**Imports pattern:**

```typescript
import { keccak256, serializeTransaction } from "viem";
import type { Address, Hex } from "viem";
```

**Core pattern** — research § Code Example 2 (line 571-611). Key shape:

```typescript
export function computePresignHash(input: {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gas: bigint;
  to: Address;
  value: bigint;
  data: Hex;
}): { serialized: Hex; presignHash: Hex } {
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: input.chainId,
    nonce: input.nonce,
    to: input.to,
    value: input.value,
    gas: input.gas,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    data: input.data,
    accessList: [],
  });
  return { serialized, presignHash: keccak256(serialized) };
}
```

**Verified test fixture (research § Code Example 2 line 615-628):**
- Inputs above + `{ nonce: 7, gas: 21000n, maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n }` →
  - `serialized` = `0x02f001078459682f008506fc23ac008252089470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c0`
  - `presignHash` = `0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85`

**Done criteria:**
- Exports a single `computePresignHash(input): { serialized; presignHash }` function.
- Always passes `accessList: []` explicitly (research § Pitfall — viem otherwise infers from inputs).
- Returns both `serialized` AND `presignHash` so callers don't re-serialize (test round-trip uses `parseTransaction(serialized)`).

---

### `src/signing/blocks.ts` (signing-block-template, constants)

**Analog (EXACT):** `src/tools/pair_ledger_live.ts:51-61` — the `VERIFY_ON_DEVICE_TEMPLATE` const is the SOT precedent.

**Format-fanout-sentinel pattern** (`src/tools/pair_ledger_live.ts:51-61`):

```typescript
export const VERIFY_ON_DEVICE_TEMPLATE: string = [
  "VERIFY-ON-DEVICE",
  "  Address: {ADDRESS}",
  "  Session topic (last 8): {SESSION_TOPIC_LAST8}",
  "",
  "In Ledger Live → Settings → Connected Apps:",
  "  - Confirm the address shown for this app matches the address above.",
  "  - Confirm the session topic (last 8 hex chars) matches.",
  "  - If either doesn't match, DO NOT proceed with any signing flow.",
  "    Treat it as a tamper signal and re-pair with force: true.",
].join("\n");
```

Apply to ALL four Phase 4 templates verbatim. Each is a plain `string` (NOT a tagged template, NOT a function) so tests' `result.content[0].text.includes(expectedSubstituted)` assertion works against runtime `.replace` substitution.

**Templates to author** (research § Pattern 2 supplies the body of each):

1. `PREPARE_RECEIPT_TEMPLATE` — placeholders `{TO}`, `{VALUE_WEI}`. Two-row block.
2. `LEDGER_BLIND_SIGN_HASH_TEMPLATE` — placeholder `{PRESIGN_HASH}`. Five-row block with character-for-character matching prose.
3. `AGENT_TASK_TEMPLATE` — placeholders `{TO}`, `{VALUE_WEI}`, `{PRESIGN_HASH}`. Multi-step prose + `CHECKS PERFORMED` sub-block format.
4. `VERIFY_BEFORE_SIGNING_TEMPLATE` — composite block for `get_tx_verification` re-emit. Placeholders inherited from above.

**Substitution rule** — chained `.replace`, NOT template literals:

```typescript
// Pattern from src/tools/pair_ledger_live.ts:109-111
const verifyBlock = VERIFY_ON_DEVICE_TEMPLATE
  .replace("{ADDRESS}", address)
  .replace("{SESSION_TOPIC_LAST8}", sessionTopicLast8);
```

Apply identically. Each `.replace` is a literal-string match (single occurrence per template). If a placeholder needs to appear in TWO positions in the same block, use the same placeholder name TWICE and the chained `.replace(/{X}/g, value)` regex form — but Phase 4's four templates have one occurrence each, so the simple form is right.

**Done criteria:**
- Four `export const NAME: string = [...].join("\n")` declarations.
- No imports, no runtime logic — pure data module.
- Placeholders use `{NAME_IN_SCREAMING_SNAKE_CASE}` (matches `VERIFY_ON_DEVICE_TEMPLATE`'s `{ADDRESS}` / `{SESSION_TOPIC_LAST8}` convention).
- The file's top comment names the format-fanout-regex-sync rule explicitly + cross-references `src/tools/pair_ledger_live.ts:51-61` as the precedent.

---

### `src/signing/error-codes.ts` (signing-error, constants)

**No analog — see § No Analog Found.** Phase 4 introduces the first typed errorCode catalog. Phase 3 used inline string literals (`"MISSING_PROJECT_ID"` typed in the structuredContent assignment). Phase 4 has eleven codes across four tools — a typed union prevents drift.

**Shape** (locked here as the project convention going forward):

```typescript
/**
 * The full set of routable errorCodes a Phase 4 signing-pipeline tool may
 * emit in `structuredContent.errorCode`. The agent pattern-matches on this
 * field exclusively; free-text errors are for the user, not for the agent.
 *
 * Convention: SCREAMING_SNAKE_CASE; verbs in the past tense ("REJECTED",
 * "EXPIRED", "FAILED") or imperative-resource form ("WALLET_NOT_PAIRED").
 * INTERNAL_ERROR is the unstructured catch-all and is NOT in the locked set.
 */
export type SigningErrorCode =
  | "WALLET_NOT_PAIRED"
  | "HANDLE_NOT_FOUND"
  | "HANDLE_EXPIRED"
  | "WRONG_STATUS"
  | "PREVIEW_REQUIRED"
  | "PREVIEW_TOKEN_MISMATCH"
  | "PAYLOAD_FINGERPRINT_DRIFT"
  | "LEDGER_REJECTED"
  | "BROADCAST_FAILED"
  | "USER_CANCELLED"
  | "INTERNAL_ERROR";  // defensive — not locked, but listed so the union is exhaustive
```

**Why a separate file (vs inline literals like Phase 3):**
- Eleven codes across four tools. Typo risk on inline literals (`PREVIWE_REQUIRED` vs `PREVIEW_REQUIRED`) is real and tests don't catch them across tool boundaries.
- `transitionToPreviewed` returns `{ ok: false; errorCode: "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED" | "WRONG_STATUS" }` — narrowing requires the union to be a single SOT.
- The skill (`vaultpilot-preflight`, v1.3 per ADR-0003) pattern-matches on the agent's `CHECKS PERFORMED` block; codes that drift across releases break the skill silently.

**No re-export from the tool layer.** Tools `import type { SigningErrorCode } from "../signing/error-codes.js"` and produce literal strings in their handler bodies; the type guards against typos at compile time.

**Done criteria:**
- Single exported type `SigningErrorCode`.
- Doc comment naming the locked set (excluding `INTERNAL_ERROR`).
- No runtime exports — pure type module.

---

### `src/clients/fourbyte.ts` (http-client, request-response HTTP)

**Analog (EXACT role):** `src/pricing/defillama.ts:52-138` — HTTP `fetch` + in-memory cache + `log("warn", ...)` on failure + result-type union for "found / unknown / error".

**Note:** Research § Recommended Project Structure places this at `src/signing/fourbyte.ts`. The phase brief lists `src/clients/fourbyte.ts`. The planner should pick one; the pattern below uses `src/clients/` to match the brief's listing. If `src/signing/` wins, the same patterns apply — pure path swap.

**Imports + URL constant pattern** (`src/pricing/defillama.ts:1-3, 23`):

```typescript
import { getAddress, type Address } from "viem";

import { log } from "../diagnostics/logger.js";

// ... later ...
const DEFILLAMA_BASE_URL = "https://coins.llama.fi";
```

Apply to fourbyte:

```typescript
import type { Hex } from "viem";
import { log } from "../diagnostics/logger.js";

const FOURBYTE_API_URL = "https://www.4byte.directory/api/v1/signatures/";
const FOURBYTE_TIMEOUT_MS = 1_500;
const CACHE_MAX_ENTRIES = 256;
```

**Cache pattern** (`src/pricing/defillama.ts:32`):

```typescript
const cache = new Map<Hex, FourbyteResult>();
```

Same shape. The Map's iteration order gives implicit LRU (Map remembers insertion order); `cache.size >= CACHE_MAX_ENTRIES` → `cache.delete(cache.keys().next().value)` evicts the oldest entry.

**Discriminated-union result pattern** (no analog — Phase 4 first):

```typescript
export type FourbyteResult =
  | { kind: "not-applicable" }
  | { kind: "found"; textSignature: string }
  | { kind: "not-found" }
  | { kind: "error"; message: string };
```

The agent (and downstream `preview_send` block formatter) discriminates on `kind`. The `message` field on `kind: "error"` is surfaced VERBATIM in the cross-check block per PREP-06 ("error / not-applicable states surface verbatim, not masked").

**AbortController timeout pattern** (no codebase analog — see § No Analog Found note 5):

```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), FOURBYTE_TIMEOUT_MS);
try {
  const resp = await fetch(url, { signal: controller.signal });
  // ...
} catch (err) {
  if ((err as Error).name === "AbortError") {
    result = { kind: "error", message: "4byte.directory unreachable (timeout 1.5s)" };
  } else {
    result = { kind: "error", message: `4byte.directory unreachable: ${(err as Error).message}` };
  }
  log("warn", `4byte.directory lookup failed for ${selector}: ${result.kind === "error" ? result.message : ""}`);
} finally {
  clearTimeout(timer);
}
```

Verbatim from research § Code Example 5 (line 822-852). Key points:
- `clearTimeout(timer)` in `finally` — prevents the unref'd timer leak under vitest.
- `log("warn", ...)` to stderr (CLAUDE.md "stderr for diagnostics" rule).
- Errors are cached too (a short cache window prevents hammering a down API).

**Done criteria:**
- Exports `lookupSelector(selector: Hex | null): Promise<FourbyteResult>`.
- `null` selector (i.e. `data === "0x"`) returns `{ kind: "not-applicable" }` synchronously-ish.
- Cache cap at 256 entries; LRU via Map insertion order.
- Exports `_resetFourbyteCacheForTesting(): void`.

---

### `src/tools/prepare_native_send.ts` (tool, signing — request-response)

**Analog:** `src/tools/pair_ledger_live.ts` (EXACT). Same shape: `isDemoMode()` FIRST → JSON-schema-gated args → service calls → structured errorCode envelope on the catch ladder → format-fanout block emission on success.

**Imports pattern** (`src/tools/pair_ledger_live.ts:30-38`):

```typescript
import { isDemoMode } from "../config/env.js";
import {
  ApprovalTimeoutError,
  PendingPairingError,
  UserRejectedPairingError,
  pair,
} from "../wallet/session-manager.js";
import { MissingProjectIdError } from "../wallet/walletconnect-client.js";
import { registerTool } from "./index.js";
```

Apply to prepare_native_send (mix viem actions + signing modules + session-manager):

```typescript
import { type Address, getAddress, isAddress } from "viem";
import { getTransactionCount, estimateGas } from "viem/actions";  // or read off the public client

import { getEthereumClient } from "../chains/ethereum.js";
import { isDemoMode } from "../config/env.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { createHandle } from "../signing/handle-store.js";
import { PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";
```

**Tool description pattern** (`src/tools/pair_ledger_live.ts:63-70`) — array-of-paragraphs joined by `" "`, 4-6 paragraphs:

```typescript
const DESCRIPTION = [
  "Pair a Ledger hardware wallet via WalletConnect so subsequent prepare_* tools can route unsigned transactions to the device for signing.",
  "Use this once per session BEFORE any prepare_* / send_transaction tool — the trust pipeline cannot operate without a paired Ledger.",
  "DO NOT use this for read-only flows (get_portfolio_summary, get_token_balance, get_transaction_status, resolve_ens_name) — those work without pairing.",
  "Returns `{ wcUri, address, chainId, sessionTopicLast8 }`. The wcUri is what the user pastes into Ledger Live (Settings → WalletConnect → Connect). Tool blocks up to 60s waiting for session approval.",
  "Pass `force: true` to disconnect any existing session and pair from scratch (e.g. after switching accounts in Ledger Live). Without `force`, repeated calls return the cached session immediately.",
  "The response carries a VERIFY-ON-DEVICE block instructing the user to confirm the surfaced address matches Ledger Live → Settings → Connected Apps; this is a tamper signal — if it doesn't match, a MITM may be active.",
].join(" ");
```

Apply: WHAT it does + WHEN to use + WHEN NOT to use + what it returns + parameter semantics + security context. For `prepare_native_send`, anti-route to `prepare_token_send` (Phase 6) explicitly — DESCRIPTION names "NATIVE ETH ONLY, NOT for ERC-20 transfers".

**Input schema pattern** (`src/tools/get_token_balance.ts:13-29`):

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

Apply: `to: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }`, `valueWei: { type: "string", pattern: "^[0-9]+$" }` (decimal-string wei units per the project's "decimal strings cross the boundary" rule); both `required`; `additionalProperties: false`.

**Handler body — demo-mode + try/catch + structured errorCode** (`src/tools/pair_ledger_live.ts:84-194`):

```typescript
// from src/tools/pair_ledger_live.ts:84-99
registerTool("pair_ledger_live", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE session-manager.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: demo mode is active; use `set_demo_wallet` to select a curated persona instead of pairing a real Ledger" }],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  const force = args.force === true;

  try {
    const result = await pair({ force });
    // ... success path ...
  } catch (err) {
    if (err instanceof MissingProjectIdError) {
      return { isError: true, content: [...], structuredContent: { errorCode: "MISSING_PROJECT_ID" } };
    }
    if (err instanceof ApprovalTimeoutError) { /* APPROVAL_TIMEOUT */ }
    // ...
    return { isError: true, content: [...], structuredContent: { errorCode: "INTERNAL_ERROR" } };
  }
});
```

Apply to prepare_native_send:
1. `isDemoMode()` FIRST → `DEMO_MODE_REFUSED` envelope.
2. Validate `args.to` + `args.valueWei` (the JSON-schema-gated `pattern` is the first line; the handler's `isAddress()` + `BigInt(args.valueWei)` parse is defense-in-depth).
3. `const status = await getStatus()` — if `null`, return `WALLET_NOT_PAIRED`.
4. Build `tx: PreparedTx` (chainId from `status.chainId`; to from `getAddress(args.to)`; valueWei from `BigInt(args.valueWei)`; data = `"0x"`; estimate nonce + gas + fees via viem actions in parallel — research § Code Example 3 has the sketch).
5. `payloadFingerprint = computePayloadFingerprint({ chainId, to, valueWei, data: "0x" })`.
6. `const handle = createHandle({ args: { to: args.to as string, valueWei: args.valueWei as string }, tx, payloadFingerprint })` — **NOTE the args are stored verbatim, NOT checksummed** (per research § Pitfall 3).
7. Build the PREPARE RECEIPT block: `PREPARE_RECEIPT_TEMPLATE.replace("{TO}", args.to).replace("{VALUE_WEI}", args.valueWei)`.
8. Return `{ content: [{ type: "text", text: receiptBlock }], structuredContent: { handle, chainId, to, valueWei, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, payloadFingerprint, prepareReceipt: { to: args.to, valueWei: args.valueWei } } }`.

**Error handling pattern** — match `src/tools/pair_ledger_live.ts:116-194` catch ladder. Each branch returns the same envelope shape; errorCodes are SigningErrorCode values from `error-codes.ts`. Catch-all `Error` → `INTERNAL_ERROR`.

**Done criteria:**
- File top comment names the four invariants: PREP-01 (return shape), PREP-02 (verbatim PREPARE RECEIPT), PREP-03 (payloadFingerprint computed here), `isDemoMode()`-first.
- DESCRIPTION array length ≥ 4 paragraphs, total ≥ MIN_DESCRIPTION_LEN (100 chars per `src/tools/index.ts:28`).
- Handler stores `args` verbatim on the handle record (no normalization).

---

### `src/tools/preview_send.ts` (tool, signing — request-response composing two)

**Analog:** `src/tools/pair_ledger_live.ts` (handler skeleton) + `src/tools/get_token_balance.ts:60-78` (parallel viem reads via `Promise.all`).

**Parallel-viem-reads pattern** (`src/tools/get_token_balance.ts:60-78`):

```typescript
const [balanceRaw, decimals, symbol] = await Promise.all([
  client.readContract({ /* balanceOf */ }),
  client.readContract({ /* decimals */ }),
  client.readContract({ /* symbol */ }),
]);
```

Apply: three parallel reads at preview time (per research § Code Example 3 line 657-662):

```typescript
const [pendingNonce, fees, gasEstimate] = await Promise.all([
  getTransactionCount(client, { address: status.address, blockTag: "pending" }),
  estimateFeesPerGas(client, { type: "eip1559" }),
  estimateGas(client, { account: status.address, to: tx.to, value: tx.valueWei }),
]);
```

**Critical correction from research** (§ Code Example 3 NOTE block, line 663-666): `getTransactionCount` takes the SENDER address, not the recipient. Use `status.address` from the session-manager's `getStatus()` call — NOT `tx.to`.

**Handler body composition:**
1. `isDemoMode()` FIRST → `DEMO_MODE_REFUSED`.
2. Validate `args.handle` (UUID-shaped string).
3. `lookup(args.handle)` → on `HANDLE_NOT_FOUND` / `HANDLE_EXPIRED` return the matching errorCode envelope.
4. Check record status — must be `"prepared"` or re-previewable. Research § Q5 line 304-306: idempotent re-preview is allowed; `"sent"` is terminal → `WRONG_STATUS`.
5. `await getStatus()` — `null` → `WALLET_NOT_PAIRED`.
6. Three parallel viem reads (above).
7. `computePresignHash(...)` → `{ serialized, presignHash }`.
8. `selector = tx.data === "0x" ? null : tx.data.slice(0, 10) as Hex`.
9. `lookupSelector(selector)` (4byte) — best-effort; result is one of four `FourbyteResult` kinds.
10. `previewToken = crypto.randomUUID()`.
11. `transitionToPreviewed(handle, { nonce, gas, maxFeePerGas, maxPriorityFeePerGas, previewToken, presignHash, selector })`.
12. Build `content[0].text` from THREE blocks joined by `\n\n`: `LEDGER_BLIND_SIGN_HASH_TEMPLATE`-substituted + `AGENT_TASK_TEMPLATE`-substituted + the 4byte cross-check block (rendered inline from the `FourbyteResult` — separate template not needed because the 4byte block has only four variants; inline `switch (result.kind)` is more readable than a template).
13. Return `structuredContent: { previewToken, presignHash, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, selector, fourbyteResult }`.

**Done criteria:**
- All three viem reads run via `Promise.all` (NOT serial).
- `previewToken` is `crypto.randomUUID()` — never derived from inputs.
- `pinned.previewToken` lives in the handle store, NEVER in the response's `content[0].text` (the token is the schema gate; surfacing it in human-readable text would let a compromised log scrape it).

---

### `src/tools/send_transaction.ts` (tool, signing — request-response)

**Analog:** `src/tools/pair_ledger_live.ts` (try/catch ladder + WC error mapping). Secondary: `src/wallet/session-manager.ts:266-274` (`isUserRejectedError` predicate).

**Schema-level gate pattern** (NEW in Phase 4 — see § No Analog Found note 1):

```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: { type: "string" },
    previewToken: { type: "string" },
    userDecision: {
      type: "string",
      enum: ["send", "cancel"],  // research § Q15 + § Open Questions Q1 recommend BOTH values
      description: "Must be the literal string \"send\" to broadcast, or \"cancel\" for a clean exit. Any other value rejects at the MCP boundary.",
    },
  },
  required: ["handle", "previewToken", "userDecision"],
  additionalProperties: false,
};
```

**WC error-mapping pattern** (`src/wallet/session-manager.ts:266-274`):

```typescript
function isUserRejectedError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (candidate.code === 5000) return true;
  if (typeof candidate.message === "string" && /user rejected/i.test(candidate.message)) {
    return true;
  }
  return false;
}
```

Apply: refactor `isUserRejectedError` to a shared util (research § Q15 recommends this in Plan 04-04). The shared util lives in `src/wallet/session-manager.ts` (already there) — Plan 04-04 just imports it. NEW errorCode `LEDGER_REJECTED` distinguishes Ledger-device rejection (during signing) from `USER_REJECTED` (pairing).

**Handler body composition:**
1. `userDecision === "cancel"` → return `{ isError: undefined, content: [...], structuredContent: { userCancelled: true, errorCode: "USER_CANCELLED" } }`. Note: NOT `isError: true` — this is a clean exit, not an error (research § Q15 line 1041).
2. `isDemoMode()` → demo-mode-refusal envelope (Phase 5 simulation lifts this; Phase 4 refuses).
3. `lookup(args.handle)` → `HANDLE_NOT_FOUND` / `HANDLE_EXPIRED`.
4. Check `record.status !== "previewed"` → `PREVIEW_REQUIRED`.
5. Type-narrow `record.pinned` → defensively `INTERNAL_ERROR` if absent.
6. Check `record.pinned.previewToken !== args.previewToken` → `PREVIEW_TOKEN_MISMATCH`.
7. **PREP-08 fingerprint re-check:** `recomputed = computePayloadFingerprint(...)`; if `recomputed !== record.payloadFingerprint` → `PAYLOAD_FINGERPRINT_DRIFT`.
8. `await getStatus()` — `null` → `WALLET_NOT_PAIRED`.
9. `topic = getActiveSessionTopic()` (NEW export added in session-manager) — `null` → `WALLET_NOT_PAIRED`.
10. `signClient.request<Hex>({ topic, chainId: \`eip155:${tx.chainId}\`, request: { method: "eth_sendTransaction", params: [txParams] } })`.
11. On rejection: `isUserRejectedError(err)` → `LEDGER_REJECTED`; else → `BROADCAST_FAILED` (preserve `err.message`).
12. On success: `transitionToSent(handle, txHash)`; return `{ structuredContent: { txHash, broadcastedAt: new Date().toISOString() } }`.

**txParams hex-encoding pattern** (research § Code Example 4 line 757-767):

```typescript
const txParams = [{
  from: status.address,
  to: record.tx.to,
  value: `0x${record.tx.valueWei.toString(16)}`,
  gas: `0x${record.pinned.gas.toString(16)}`,
  maxFeePerGas: `0x${record.pinned.maxFeePerGas.toString(16)}`,
  maxPriorityFeePerGas: `0x${record.pinned.maxPriorityFeePerGas.toString(16)}`,
  nonce: `0x${record.pinned.nonce.toString(16)}`,
  data: record.tx.data,
}];
```

All-hex per JSON-RPC convention; bigint → hex via `.toString(16)`.

**Done criteria:**
- INPUT_SCHEMA has `userDecision.enum: ["send", "cancel"]`.
- Six structured-errorCode branches plus `INTERNAL_ERROR` catch-all.
- `getActiveSessionTopic()` is called BEFORE `signClient.request` (no race with `session_delete`).
- Response carries `broadcastedAt: new Date().toISOString()` (ISO-8601 string, not epoch ms — agent-readable).

---

### `src/tools/get_tx_verification.ts` (tool, signing — read-only)

**Analog:** `src/tools/get_ledger_status.ts` — read-only, never raises, surfaces structured `paired` or `paired: false`.

**Read-only no-error-path pattern** (`src/tools/get_ledger_status.ts:30-53`):

```typescript
registerTool("get_ledger_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  const status = await getStatus();
  if (status === null) {
    return {
      content: [{ type: "text", text: "paired: false (no Ledger session active; call pair_ledger_live to pair)" }],
      structuredContent: { paired: false },
    };
  }
  // ... structured paired-true return ...
});
```

Apply: `lookup(args.handle)` → on `HANDLE_NOT_FOUND` / `HANDLE_EXPIRED` return STRUCTURED errorCode envelope (these ARE errors — `get_tx_verification` differs from `get_ledger_status` here because a missing handle is a real failure, while an unpaired Ledger is a normal state). On found: re-emit blocks based on `record.status`:
- `"prepared"`: `PREPARE_RECEIPT_TEMPLATE` only.
- `"previewed"`: PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte block.
- `"sent"`: all of the above + success block with `txHash`.

**Cross-tool template reuse** — `get_tx_verification` MUST import the SAME `*_TEMPLATE` consts from `src/signing/blocks.ts` that `prepare_native_send` and `preview_send` use. Format-fanout-regex-sync rule: one SOT per template. Substitute via the same chained `.replace` form.

**Done criteria:**
- DESCRIPTION names the 15-min TTL + the "intra-process recovery, NOT cross-restart" limitation (per research § Pitfall 5).
- No new `*_TEMPLATE` consts — every emitted block reuses an existing template.
- Returns `paired`-style structured shape for found cases; structured errorCode envelope for `HANDLE_NOT_FOUND` / `HANDLE_EXPIRED`.

---

### `src/tools/register-all.ts` (config, extend +4 lines)

**Analog (EXACT — same file):** `src/tools/register-all.ts:1-11`. The file already lists seven imports:

```typescript
import "./resolve_ens_name.js";
import "./reverse_resolve_ens.js";
import "./get_token_balance.js";
import "./get_transaction_status.js";
import "./get_portfolio_summary.js";
import "./pair_ledger_live.js";
import "./get_ledger_status.js";

export function registerAllTools(): void {
  // Tool modules register on import. Phase 2+ adds imports above this comment.
}
```

**Apply:** Add EXACTLY FOUR import lines above the `export function registerAllTools()` line:

```typescript
import "./prepare_native_send.js";
import "./preview_send.js";
import "./send_transaction.js";
import "./get_tx_verification.js";
```

Order: by call sequence (prepare → preview → send → verify) — matches the user's mental model. The existing comment "Phase 2+ adds imports above this comment" is load-bearing — preserve it; do NOT reorder existing imports.

**Done criteria:**
- `git diff origin/main -- src/tools/register-all.ts` shows EXACTLY 4 added lines (one per tool).
- No reordering of existing imports.
- The trailing comment is unchanged.

---

### `src/wallet/session-manager.ts` (extend +1 export — `getActiveSessionTopic`)

**Analog (EXACT — same file):** `src/wallet/session-manager.ts:233-239` (`findLiveSession`). The new export is a one-line wrapper:

```typescript
// inside src/wallet/session-manager.ts — add near getStatus()
export function getActiveSessionTopic(): string | null {
  if (!_isWalletConnectClientInitialized()) return null;
  // We can't call `findLiveSession` here without awaiting the singleton.
  // Use the module-scoped `cachedSessionTopic` which is updated by every
  // happy path (pair → success, getStatus → live, session_delete → undefined).
  return cachedSessionTopic ?? null;
}
```

Or, mirroring `getStatus()` (async, calls `findLiveSession(client)`):

```typescript
export async function getActiveSessionTopic(): Promise<string | null> {
  if (!_isWalletConnectClientInitialized()) return null;
  const client = await getWalletConnectClient();
  const live = findLiveSession(client);
  return live?.topic ?? null;
}
```

**Recommendation:** the async form (mirrors `getStatus()` shape exactly). The sync form depends on `cachedSessionTopic` being current, which is fine in steady state but races with `session_delete` — async is robust.

**Done criteria:**
- One new `export` (async function).
- No behavior change in `pair()` / `getStatus()` / `disconnect()`.
- No new internal state — reuses `findLiveSession`.
- Tests in `test/wallet-session-manager.test.ts` extended with at least one case asserting the new export returns the live session's `topic` after a successful pair and `null` before pair / after `session_delete`.

---

### `test/helpers/mock-public-client.ts` (test-helper, factory)

**Analog (EXACT role):** `test/helpers/mock-sign-client.ts` — factory exposing `{ client, _simulate*, _set* }` driver shape. New helper does the same for viem's PublicClient.

**Factory shape pattern** (`test/helpers/mock-sign-client.ts:34-63`):

```typescript
export interface MockSignClient {
  client: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    session: { getAll: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  _simulateApproval: (session: SessionTypes.Struct) => void;
  // ...
}

export function createMockSignClient(): MockSignClient { /* ... */ }
```

Apply:

```typescript
export interface MockPublicClient {
  client: {
    getTransactionCount: ReturnType<typeof vi.fn>;
    estimateFeesPerGas: ReturnType<typeof vi.fn>;
    estimateGas: ReturnType<typeof vi.fn>;
    call: ReturnType<typeof vi.fn>;  // for DEMO-05 eth_call simulation (Phase 5)
  };
  _setNonce: (n: number) => void;
  _setFees: (fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) => void;
  _setGasEstimate: (g: bigint) => void;
  _setCallResponse: (hex: Hex) => void;
}

export function createMockPublicClient(): MockPublicClient { /* ... */ }
```

The `_set*` driver methods set module-private state captured by the inner `vi.fn` closures (mirrors `mock-sign-client.ts:71-110`'s `sessionsInStore` / `resolveApproval` references).

**Top comment pattern** (`test/helpers/mock-sign-client.ts:1-21`):

```typescript
// Mock for `@walletconnect/sign-client` used across Phase 3 unit tests.
//
// This helper is the SINGLE SOURCE OF TRUTH for WalletConnect SDK mocking
// in Phase 3 — `test/wallet-walletconnect-client.test.ts`, ...
```

Apply identical convention: name the SOT, list the four test files that consume it (`prepare-native-send`, `preview-send`, `send-transaction`, `trust-pipeline.integration`), reference the research § Wave 0 Gaps section.

**Done criteria:**
- Exports `createMockPublicClient(): MockPublicClient` + `MockPublicClient` type.
- Four driver methods (`_setNonce`, `_setFees`, `_setGasEstimate`, `_setCallResponse`).
- Top comment names this as the Phase 4 SOT + cross-references the mock-sign-client.ts shape.
- Returns a fresh instance per call (matches Phase 3 convention of brand-new spies per call).

---

### `test/helpers/mock-sign-client.ts` (extend, +2 driver methods)

**Analog (EXACT — same file):** `test/helpers/mock-sign-client.ts:111-141` (existing `_simulate*` methods follow the same shape).

**Pattern to mirror** (`test/helpers/mock-sign-client.ts:111-138`):

```typescript
_simulateApproval: (session) => {
  if (!resolveApproval) {
    throw new Error("_simulateApproval called before connect() — call pair() (or connect()) first, then simulate");
  }
  resolveApproval(session);
  resolveApproval = undefined;
  rejectApproval = undefined;
},
```

**Apply:** Add `_setRequestResponse(method: string, response: unknown)` and `_setRequestRejection(method: string, err: Error)` driver methods. Internally:
- Add a `Map<string, unknown>` `requestResponses` + `Map<string, Error>` `requestRejections` at module scope.
- Add `request: vi.fn(async (params: { request: { method: string } }) => { ... })` to the `client` shape — looks up `params.request.method` in the maps; returns the response or throws the rejection.
- `_setRequestResponse(method, response)` sets the response Map entry.
- `_setRequestRejection(method, err)` sets the rejection Map entry.

**Done criteria:**
- New `request: ReturnType<typeof vi.fn>` field on the `client` interface.
- Two new driver methods: `_setRequestResponse` + `_setRequestRejection`.
- Existing `_simulateApproval` / `_simulateRejection` / `_simulateTimeout` / `_simulateSessionDelete` / `_setSessionsInStore` UNCHANGED.
- Top comment updated to name Plan 04-04 + integration test as consumers.

---

### `test/signing-fingerprint.test.ts` (test — fixture-anchored)

**No analog.** See § No Analog Found note 2. Phase 4 introduces fixture-anchored crypto tests. Closest shape: any test with hardcoded expected bigint / hex byte strings.

**Test shape:**
- `import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js"`.
- Three cases:
  1. **Native send fixture** (research § Code Example 1 line 547-560 — anchor `0x7e1867b2…`).
  2. **ERC-20 transfer with 68-byte data** (forward-looking — locks Phase 6 reusability per research § Q1 line 884). Compute the expected fingerprint offline; embed as hardcoded fixture.
  3. **Wrong-input rejection** — non-address `to` (e.g. `0xshort`) → viem `hexToBytes` throws.

**Done criteria:**
- ≥ 3 `it(...)` cases.
- Expected values are HARDCODED hex strings — NOT computed at test-time by the SAME viem functions (that would be a tautology).
- The DOMAIN_TAG constant is asserted indirectly: the fixture's bytes depend on the tag; if the tag changes, the fixture breaks (which is the whole point).

---

### `test/signing-presign-hash.test.ts` (test — fixture-anchored + round-trip)

**Analog:** `test/signing-fingerprint.test.ts` (sibling once both land). Same shape.

**Test cases:**
1. **EIP-1559 native send fixture** (research § Code Example 2 line 615-628 — anchor `0xb28e4824…`).
2. **`parseTransaction(serialized)` round-trip** — research § Q8 line 950 says the agent-task contract is implementable iff parseTransaction can reconstruct the envelope; lock this with a `expect(parseTransaction(result.serialized)).toEqual({ chainId, nonce, ... })` assertion.

**Done criteria:**
- ≥ 2 `it(...)` cases.
- Round-trip assertion uses viem's `parseTransaction` (not a custom decoder).

---

### `test/signing-handle-store.test.ts` (test — state machine + fake timers)

**Analog:** `test/wallet-session-manager.test.ts` (fake timers + `_resetForTesting` between tests).

**Fake-timer pattern** (`test/wallet-session-manager.test.ts:84` + research § Q5):

```typescript
// from test/wallet-session-manager.test.ts:79-85
afterEach(() => {
  // ...
  vi.useRealTimers();
});

// inside a test:
// vi.useFakeTimers();
// vi.advanceTimersByTimeAsync(...);
```

**Test cases:**
1. `createHandle` → `lookup` returns the record with `status: "prepared"`.
2. `transitionToPreviewed` → status flips; pinned is set.
3. `transitionToSent` → status flips to terminal; `txHash` + `sentAt` populated.
4. `transitionToSent` against `"prepared"` (skipped preview) → `WRONG_STATUS`.
5. `transitionToPreviewed` against `"sent"` (terminal) → `WRONG_STATUS`.
6. Lazy TTL eviction: `vi.useFakeTimers()`, `createHandle`, `vi.advanceTimersByTime(HANDLE_TTL_MS + 1)`, `lookup` → `HANDLE_EXPIRED`; subsequent `lookup` → `HANDLE_NOT_FOUND` (the first lookup deleted it).
7. `_resetHandleStoreForTesting()` clears the Map.

**Done criteria:**
- ≥ 7 `it(...)` cases.
- Each test calls `_resetHandleStoreForTesting()` in `beforeEach`.
- The TTL test uses fake timers; calls `vi.useRealTimers()` in `afterEach`.

---

### `test/signing-blocks.test.ts` (test — string-const sanity)

**Analog:** None directly — Phase 3's `VERIFY_ON_DEVICE_TEMPLATE` is tested indirectly via the tool test (`test/pair-ledger-live.test.ts`). Phase 4 splits this into a dedicated test because four templates × four tool tests = sixteen substitution paths; a single block-shape test is cheaper.

**Test cases:**
1. All four templates are non-empty strings.
2. Each template's placeholder set matches the documented set (e.g. `PREPARE_RECEIPT_TEMPLATE.includes("{TO}")` AND `.includes("{VALUE_WEI}")`).
3. Substitution leaves no `{X}` placeholders remaining for the documented placeholder set (regex `/\{[A-Z_]+\}/` returns no match after all `.replace` calls).
4. Block-ordering invariants (e.g. `LEDGER_BLIND_SIGN_HASH_TEMPLATE` starts with `"LEDGER BLIND-SIGN HASH"`).

**Done criteria:**
- ≥ 4 `it(...)` cases.
- No tool-handler logic exercised — pure block-shape tests.

---

### `test/prepare-native-send.test.ts` (test — handler-level mocked viem)

**Analog (EXACT):** `test/get-token-balance.test.ts` (mock viem `__client`, `import "../src/tools/register-all.js"`, `getRegisteredTool`, `callTool` helper).

**Mock setup pattern** (`test/get-token-balance.test.ts:3-12`):

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

const mod = (await import("../src/chains/ethereum.js")) as unknown as {
  __client: { readContract: ReturnType<typeof vi.fn> };
};
const stubClient = mod.__client;
```

Apply: extend the `client` mock with `getTransactionCount`, `estimateFeesPerGas`, `estimateGas` (Phase 4 viem reads). Also mock `../src/wallet/session-manager.js` for `getStatus()` (the prepare handler calls it for the sender address).

**Test cases** (per research § Validation Architecture line 1086-1097):
1. **Happy path:** mock `getStatus()` returns paired status; mock viem reads return fixture values; assert response contains the PREPARE RECEIPT block VERBATIM, `payloadFingerprint` matches the Code Example 1 fixture, `structuredContent.handle` is a UUID.
2. **`isDemoMode()` first:** stub `VAULTPILOT_DEMO=true`; assert `DEMO_MODE_REFUSED`; `getStatus` spy NOT called.
3. **WALLET_NOT_PAIRED:** mock `getStatus()` returns `null`; assert `WALLET_NOT_PAIRED`.
4. **Verbatim PREPARE RECEIPT** (PREP-02 / Pitfall 3): pass `to: "0xabc…"` lowercase; assert `result.content[0].text` includes `"0xabc…"` LOWERCASE (NOT checksummed). Format-fanout: import `PREPARE_RECEIPT_TEMPLATE`, substitute, `.includes`.
5. **Invalid args:** non-hex `to` → JSON-schema rejects at the boundary (test asserts the schema's `pattern` is correct).
6. **viem RPC failure:** mock one of the parallel reads to reject → tool returns `INTERNAL_ERROR`.

**Done criteria:**
- ≥ 6 `it(...)` cases.
- Uses `__client` export trick on `../src/chains/ethereum.js`.
- Uses `vi.importActual` overlay on `../src/wallet/session-manager.js` (Phase 3 pattern from `test/pair-ledger-live.test.ts:11-21`).

---

### `test/preview-send.test.ts` (test — handler-level mocked viem + handle store)

**Analog:** `test/get-portfolio-summary.test.ts` (multiple mocked modules + per-test re-bind).

**Multi-module mock pattern** (`test/get-portfolio-summary.test.ts:9-34`):

```typescript
vi.mock("../src/chains/ethereum.js", () => { /* ... */ });
vi.mock("../src/chains/erc20-scanner.js", async () => {
  const real = await vi.importActual<typeof import("../src/chains/erc20-scanner.js")>(
    "../src/chains/erc20-scanner.js",
  );
  return {
    ...real,
    scanErc20Balances: vi.fn(async () => erc20Result),
  };
});
```

Apply: mock `../src/chains/ethereum.js`, `../src/wallet/session-manager.js`, AND `../src/clients/fourbyte.js`. The handle store is REAL (not mocked) — tests `createHandle` upstream, then call the preview handler against the real store.

**Test cases:**
1. **Happy path (fixture-anchored):** create a handle via `createHandle(...)` (REAL store) with Code Example 1 fingerprint inputs; mock viem reads return Code Example 2 fixture values; mock 4byte returns `{ kind: "not-applicable" }` (data === "0x"); assert response `content[0].text` includes LEDGER BLIND-SIGN HASH block with the Code Example 2 anchor `0xb28e4824…`.
2. **`isDemoMode()` first.**
3. **HANDLE_NOT_FOUND:** bogus handle UUID.
4. **HANDLE_EXPIRED:** advance fake timers past 15 min.
5. **Already-`"sent"` handle:** transition to sent upstream; preview attempts → `WRONG_STATUS`.
6. **WALLET_NOT_PAIRED.**
7. **`previewToken` is UUID-shaped** (regex on UUID v4 form).
8. **4byte `found`:** mock returns `{ kind: "found", textSignature: "transfer(address,uint256)" }`; assert the cross-check block surfaces `"transfer(address,uint256)"`.
9. **4byte `error`:** mock returns `{ kind: "error", message: "..." }`; assert the cross-check block surfaces the message VERBATIM.

**Done criteria:**
- ≥ 9 `it(...)` cases.
- Real handle store; mocked viem + 4byte.
- Fake timers for the TTL test only.

---

### `test/send-transaction.test.ts` (test — handler-level mocked WC + handle store)

**Analog (EXACT):** `test/pair-ledger-live.test.ts` (mock session-manager via `vi.importActual` overlay; structured errorCode assertions).

**Mock-session-manager overlay pattern** (`test/pair-ledger-live.test.ts:11-21`):

```typescript
const pairSpy = vi.fn();

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    pair: (...args: Parameters<typeof actual.pair>) => pairSpy(...args),
    getStatus: vi.fn(async () => null),
    disconnect: vi.fn(async () => undefined),
  };
});
```

Apply: same shape; overlay `getStatus` + `getActiveSessionTopic` with `vi.fn`. ALSO mock `@walletconnect/sign-client` to substitute `SignClient.init` (use `createMockSignClient()` from the extended Phase 3 helper).

**Test cases:**
1. **Happy path:** create handle (REAL store), transition to previewed, call send_transaction with matching previewToken + `userDecision: "send"`. Mock `signClient.request` resolves with `0xdeadbeef...` hash. Assert `structuredContent.txHash === "0xdeadbeef..."` + `broadcastedAt` is ISO-8601.
2. **Schema gate — `userDecision: "yes"`:** call with invalid value; assert MCP boundary rejection (the handler never runs — test the schema's `enum: ["send", "cancel"]` lockdown).
3. **`userDecision: "cancel"`:** clean exit; `USER_CANCELLED`; `isError` undefined (not a failure).
4. **`isDemoMode()` first.**
5. **HANDLE_NOT_FOUND / HANDLE_EXPIRED / WRONG_STATUS (preview not run) / PREVIEW_TOKEN_MISMATCH.**
6. **PAYLOAD_FINGERPRINT_DRIFT:** forcibly mutate `record.payloadFingerprint` via a test-only helper; assert `PAYLOAD_FINGERPRINT_DRIFT`.
7. **WALLET_NOT_PAIRED:** `getStatus` returns null OR `getActiveSessionTopic` returns null.
8. **LEDGER_REJECTED:** mock `request` rejects with `{ code: 5000, message: "User rejected." }`; assert `LEDGER_REJECTED`.
9. **BROADCAST_FAILED:** mock `request` rejects with `new Error("nonce too low")`; assert `BROADCAST_FAILED` + message preserved.
10. **PREP-09 forward shape:** assert `signClient.request` called with `{ topic, chainId: "eip155:1", request: { method: "eth_sendTransaction", params: [{ from, to, value, gas, ... }] } }` — each param hex-encoded.

**Done criteria:**
- ≥ 10 `it(...)` cases.
- Uses `vi.importActual` overlay for session-manager.
- Uses the extended `mock-sign-client.ts` `_setRequestResponse` / `_setRequestRejection` driver methods.

---

### `test/get-tx-verification.test.ts` (test — read-only + fake timers)

**Analog:** `test/get-ledger-status.test.ts` (no-error read path) + fake-timer pattern from `test/wallet-session-manager.test.ts`.

**Test cases:**
1. **Handle status = "prepared" → re-emit PREPARE RECEIPT only.**
2. **Handle status = "previewed" → re-emit RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte block.**
3. **Handle status = "sent" → all of the above + success block with txHash.**
4. **HANDLE_NOT_FOUND.**
5. **HANDLE_EXPIRED via fake-timer advance past 15 min.**

**Done criteria:**
- ≥ 5 `it(...)` cases.
- Uses fake timers for the TTL test.
- Imports the SAME `*_TEMPLATE` consts from `src/signing/blocks.ts` that the prod handler uses (format-fanout-regex-sync).

---

### `test/fourbyte.test.ts` (test — fetch mocked + AbortController)

**Analog:** `test/pricing-defillama.test.ts` (mocked `fetch` global; cache assertions).

**Test cases (per research § Wave 0 Gaps):**
1. **Selector found:** mock fetch returns `{ results: [{ text_signature: "transfer(address,uint256)" }] }`; assert `{ kind: "found", textSignature: "transfer(address,uint256)" }`.
2. **Selector not-found:** mock fetch returns `{ results: [] }`; assert `{ kind: "not-found" }`.
3. **HTTP error:** mock fetch returns `{ ok: false, status: 500 }`; assert `{ kind: "error", message: /HTTP 500/ }`.
4. **Network error:** mock fetch rejects with `new Error("ENOTFOUND")`; assert `{ kind: "error", message: /ENOTFOUND/ }`.
5. **Not-applicable:** `lookupSelector(null)` → `{ kind: "not-applicable" }` without firing fetch.
6. **Cache hit:** call twice with same selector; assert `fetch` called once.
7. **Timeout (AbortController):** mock fetch to never resolve; advance fake timers past 1.5s; assert `{ kind: "error", message: /timeout 1\.5s/ }`.

**Done criteria:**
- ≥ 7 `it(...)` cases.
- Mocks the global `fetch` via `vi.stubGlobal("fetch", ...)`.
- Uses fake timers for the timeout test.

---

### `test/trust-pipeline.integration.test.ts` (test — integration composing two helpers)

**No analog.** See § No Analog Found note 4. Phase 4 introduces the first integration test composing multiple Wave 0 helpers (mock-public-client + mock-sign-client).

**Test composition** (per research § Q12 line 988-993):
1. Mock `../src/chains/ethereum.js` via `createMockPublicClient()` — set `_setNonce(7)`, `_setFees({ maxFeePerGas: 30e9, maxPriorityFeePerGas: 1.5e9 })`, `_setGasEstimate(21000n)`.
2. Mock `@walletconnect/sign-client` via the extended `mock-sign-client.ts` — `_setRequestResponse("eth_sendTransaction", "0x000…01")`.
3. Mock `../src/wallet/session-manager.js` via `vi.importActual` overlay — `getStatus()` returns paired status; `getActiveSessionTopic()` returns a known topic.
4. Walk: `prepare_native_send({ to: "0x7099...79C8", valueWei: "1000000000000000000" })` → assert `payloadFingerprint === "0x7e1867b2..."` (Code Example 1).
5. Walk: `preview_send({ handle })` → assert `presignHash === "0xb28e4824..."` (Code Example 2) AND `signClient.request` NOT YET CALLED.
6. Walk: `send_transaction({ handle, previewToken, userDecision: "send" })` → assert `signClient.request` called with EXACT pinned params (no re-fetch at send time); response `txHash === "0x000…01"`.
7. Bonus assertion: `payloadFingerprint` IDENTICAL across prepare → preview → send (single test reads it from all three responses).

**Done criteria:**
- ONE comprehensive `it(...)` walking the full flow + one bonus assertion.
- Composes mock-public-client + extended mock-sign-client.
- Anchor fixture matches Code Example 1 + 2 byte-for-byte.

## Shared Patterns

### Logging (stderr-only)

**Source:** `src/diagnostics/logger.ts:3-5`
**Apply to:** `src/clients/fourbyte.ts` (cache-miss warns on errors), `src/wallet/session-manager.ts` (already uses it for `session_delete` events).

```typescript
import { log } from "../diagnostics/logger.js";
log("warn", `4byte.directory lookup failed for ${selector}: ${message}`);
```

**Rule:** stderr for diagnostics, stdout for MCP protocol. No `console.log` anywhere.

### Error-class convention (FROM PHASE 3 — preserve verbatim)

**Source:** `src/wallet/walletconnect-client.ts:59-67` (`MissingProjectIdError`)
**Apply to:** any new domain errors. Phase 4 introduces NO new custom Error subclasses — all error paths surface via structured `errorCode` in `structuredContent`. The `error-codes.ts` union is the SOT.

**Why no new Error classes:** Phase 3 had four (`Missing` / `Approval` / `User` / `Pending`) because the session-manager threw across module boundaries (`tools/pair_ledger_live.ts` `instanceof`-dispatches). Phase 4's `src/signing/` modules return discriminated `LookupResult` / `TransitionResult` unions — no throwing across boundaries — so no Error subclasses are needed. This is a deliberate constraint, not an omission.

### Structured errorCode envelope (FROM PHASE 3 — extend the catalog)

**Source:** `src/tools/pair_ledger_live.ts:87-99` (the demo-mode refusal shape)
**Apply to:** every Phase 4 tool handler error branch.

```typescript
return {
  isError: true,
  content: [{ type: "text", text: "error: <human-readable>" }],
  structuredContent: { errorCode: "<SCREAMING_SNAKE_CASE>" },
};
```

**Phase 4 adds 10 new locked codes** (research § Q15) — see § `src/signing/error-codes.ts` above for the full union. The defensive catch-all `INTERNAL_ERROR` is NOT in the locked set.

**One subtle deviation for `USER_CANCELLED`:** research § Q15 line 1041 + research § Open Questions Q1 recommend `userDecision: "cancel"` as a CLEAN exit, NOT an error. So this branch returns `isError: undefined` (or omitted), `structuredContent: { errorCode: "USER_CANCELLED", userCancelled: true }`. This is the ONLY Phase 4 errorCode that doesn't carry `isError: true`.

### Input validation pattern

**Source:** `src/tools/get_token_balance.ts:43-57`
**Apply to:** every Phase 4 prepare / preview / send tool.

```typescript
if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
  return {
    content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed Ethereum address" }],
    isError: true,
  };
}
```

JSON-schema `pattern` is the first line; this handler-level check is defense-in-depth for callers that bypass the schema. For Phase 4: `valueWei: string` validates via `BigInt(args.valueWei)` in a try/catch (decimal-string per CLAUDE.md "decimal-aware arithmetic"); `handle: string` validates via UUID-shape regex.

### Tool description = agent routing prompt

**Source:** `src/tools/pair_ledger_live.ts:63-70`
**Apply to:** all four Phase 4 tool descriptions.

Array-of-paragraphs joined by `" "`, ≥ 100 chars total (per `src/tools/index.ts:28` MIN_DESCRIPTION_LEN warning), 4-6 paragraphs covering: (1) WHAT it does + return shape, (2) WHEN to use, (3) WHEN NOT to use (anti-route to siblings — `prepare_native_send` anti-routes to `prepare_token_send` even though the latter is Phase 6), (4) parameter semantics, (5) security context (PREPARE RECEIPT / LEDGER BLIND-SIGN HASH meaning).

### Side-effect-import tool registration

**Source:** `src/tools/register-all.ts:1-11`
**Apply to:** all four Phase 4 tools — each is a module-top-level `registerTool(...)` call; `register-all.ts` gains one import line per tool.

### Format-fanout-regex-sync (CLAUDE.md global rule)

**Source:** `src/tools/pair_ledger_live.ts:51-61` (precedent) + `test/pair-ledger-live.test.ts:37, 73-` (test imports the const)
**Apply to:** all four Phase 4 templates in `src/signing/blocks.ts`. EVERY test that asserts block content imports the SAME `*_TEMPLATE` const and substitutes the same way the handler does. `.toContain(...)` against an inline string literal is BANNED for block content.

### Tool-handler return shape

**Source:** `src/tools/index.ts:14-19`
**Apply to:** every Phase 4 tool handler. Always populate BOTH `content` (human-readable) AND `structuredContent` (agent-routable). On error, BOTH still populated (errorCode in structuredContent; error text in content).

### Test mock setup convention

**Source:** `test/get-token-balance.test.ts:3-12, 21-24` (`__client` export trick) + `test/pair-ledger-live.test.ts:11-21` (`vi.importActual` overlay)
**Apply to:** all Phase 4 unit tests.

- `vi.mock(...)` calls hoisted before `import` statements.
- For SDK / 3rd-party module mocks: full replacement.
- For internal module mocks (`../src/wallet/session-manager.js`, `../src/signing/handle-store.js`): use `vi.importActual` overlay — keep error classes / type exports REAL; mock function exports.
- `__client` re-export trick for single-instance mock state.
- Per-test re-bindable variables at module scope for multi-state mocks (research-confirmed pattern from `test/get-portfolio-summary.test.ts`).
- `_reset*ForTesting()` in `beforeEach`.
- Each test file calls `import "../src/tools/register-all.js"` after mocks to trigger registration under the mocks.

### Fake-timer pattern (FROM PHASE 3)

**Source:** `test/wallet-session-manager.test.ts:84` (`vi.useRealTimers()` in afterEach)
**Apply to:** `test/signing-handle-store.test.ts` (TTL eviction), `test/get-tx-verification.test.ts` (TTL re-emit refusal), `test/fourbyte.test.ts` (1.5s timeout).

Use `vi.useFakeTimers()` per-test inside the test body; `vi.useRealTimers()` in `afterEach`. For async-aware advance use `vi.advanceTimersByTimeAsync(ms)` so pending Promises flush.

## Phase 2/3 Conventions To Preserve

Per-line summaries of conventions Phase 4 inherits without reshape:

- **NodeNext ESM imports** — relative imports use `.js` extension (compiled output); `import type` for type-only.
- **`as const` on schema `type: "object"`** — `src/tools/get_token_balance.ts:14`. Keep.
- **`additionalProperties: false` on every inputSchema** — locks the wire shape.
- **Pattern strings for address inputs** — `^0x[0-9a-fA-F]{40}$` for addresses; `^0x[0-9a-fA-F]{64}$` for tx hashes; `^[0-9]+$` for decimal-string wei values (NEW in Phase 4).
- **DESCRIPTION as array-of-paragraphs joined by spaces** — minimum 100 chars; 4-6 paragraphs; WHAT + WHEN + WHEN-NOT + return shape + security context.
- **`isDemoMode()` first in every signing-pipeline tool handler** — Phase 4 has zero exceptions; Phase 5 lifts this for `send_transaction` only (to a simulation envelope).
- **`getStatus()` returns null without triggering init** — preserved; new `getActiveSessionTopic()` MUST mirror this short-circuit.
- **No `walletconnect.db` on disk** — Phase 3's `storageOptions: { database: ":memory:" }` is untouched; Phase 4 NEVER calls `SignClient.init` directly.
- **`log("warn", ...)` to stderr on best-effort failures** — Phase 4's `src/clients/fourbyte.ts` follows this. Never silently swallow.
- **`crypto.randomUUID()` for one-time tokens** — `handle` + `previewToken`. NOT a derived hash.
- **`bigint`-native arithmetic via viem** — never coerce to `Number` for wei amounts.
- **Test file naming** — `<feature>.test.ts` directly under `test/`; helpers under `test/helpers/`. No nested directories.

## No Analog Found

The Phase 4 planner MUST call these out explicitly so a later phase doesn't accidentally restyle them.

### Note 1: Schema-level `enum: ["send", "cancel"]` gate on `userDecision`

**File:** `src/tools/send_transaction.ts` INPUT_SCHEMA
**Why no analog:** Phase 1/2/3 tools accept free-form string args (`wallet`, `tokenAddress`, `txHash`) with only `pattern` validation. The `userDecision` field is the FIRST hard-locked enum constraint anywhere in the project's MCP schemas. The MCP SDK's `ajv` validator enforces it BEFORE the handler runs — this is the load-bearing PREP-07 defense. Future phases must NOT add an `else` branch in the handler that accepts other values; the schema is the authoritative gate.

**Pattern to lock here** (research § Pattern 3 line 396-409):

```typescript
userDecision: {
  type: "string",
  enum: ["send", "cancel"],
  description: "Must be the literal string \"send\" to broadcast, or \"cancel\" for a clean exit. Any other value rejects at the MCP boundary.",
},
```

### Note 2: Fixture-anchored crypto tests

**Files:** `test/signing-fingerprint.test.ts`, `test/signing-presign-hash.test.ts`
**Why no analog:** Phase 2 tests assert against viem's outputs (`balanceOf` result mocked; the test asserts the mock's value is surfaced). Phase 4 introduces tests that lock CRYPTO INVARIANTS — the keccak256 of a known preimage MUST produce a hardcoded hex. The expected value is computed ONCE offline (research § Code Example 1 line 547-560 + Code Example 2 line 615-628 supply the values); the test asserts the production code STILL produces those bytes.

**Pattern to lock:**
- Hardcoded hex strings, NOT computed at test-time by the SAME viem functions the production code uses.
- Tests anchor against the PREIMAGE LAYOUT, not just the output hash — if a future contributor reorders the `concat([...])` args, the test fails even if the hash happens to collide (which it won't, but the principle stands).
- `FINGERPRINT_DOMAIN_TAG` is exported; the fixture's bytes encode the tag's UTF-8 prefix; if the tag changes, the fixture breaks. The export ALSO enables a direct `length === 23` regression anchor.

### Note 3: Dedicated `test/signing-blocks.test.ts`

**File:** `test/signing-blocks.test.ts`
**Why no analog:** Phase 3's `VERIFY_ON_DEVICE_TEMPLATE` is tested indirectly via the tool test. Phase 4 has four templates × four tool tests = sixteen substitution paths; a single block-shape test (asserting placeholders exist, no leftover `{X}` after substitution, ordering invariants) is cheaper than wiring those into each tool test. This is a Phase 4 convention worth keeping — Phase 6's `PREPARE_RECEIPT_TOKEN_SEND_TEMPLATE` will follow the same shape.

### Note 4: Integration test composing two Wave 0 helpers

**File:** `test/trust-pipeline.integration.test.ts`
**Why no analog:** Phase 1/2/3 tests are unit-only — each mocks ONE upstream module. Phase 4's `trust-pipeline.integration.test.ts` walks the FULL flow (prepare → preview → send) against TWO mocked SDKs (viem PublicClient + WC SignClient) plus the REAL handle store. The fixture chain (`payloadFingerprint` from prepare matches preview matches send) is the load-bearing assertion — no unit test can catch a transition-time drift bug.

**Pattern to lock:**
- ONE integration test per phase that introduces tooling crossing ≥ 2 mocked SDK boundaries.
- Anchor against research-supplied fixtures (Code Example 1 + 2 hashes).
- Composes Wave 0 helpers (`createMockPublicClient` + extended `createMockSignClient`); does NOT redefine mocks inline.

### Note 5: AbortController + setTimeout-based fetch timeout

**File:** `src/clients/fourbyte.ts`
**Why no analog:** Phase 2's `src/pricing/defillama.ts` uses bare `fetch` with no timeout. Phase 4's 4byte client needs a 1.5s budget so a slow API never blocks `preview_send`. The `AbortController.abort()` triggered by `setTimeout` is the canonical Node 18+ pattern. `clearTimeout` in `finally` prevents the unref'd timer leak under vitest fake-timers.

**Pattern to lock** (research § Code Example 5 line 822-852 supplies the verbatim implementation).

### Note 6: `src/signing/error-codes.ts` typed errorCode catalog

**File:** `src/signing/error-codes.ts`
**Why no analog:** Phase 3's five errorCodes are inline string literals at the four use sites — `MISSING_PROJECT_ID` etc. appear as bare literals in the `structuredContent` field. Phase 4 has eleven codes across four tools; the typo risk on inline literals is real, and the handle-store's discriminated-union result types need to narrow to a subset (e.g. `HANDLE_NOT_FOUND | HANDLE_EXPIRED`). A single typed union is the SOT.

**Pattern to lock:** the union literal type lives in `src/signing/error-codes.ts`; producers import the type and emit literal strings; the type guards against typos at compile time. NO runtime enum (the literal string is the wire shape).

### Note 7: In-memory handle store as a monotonic state machine

**File:** `src/signing/handle-store.ts`
**Why no analog:** Phase 2's pricing cache is a pure memoize (key → value, expire by time). The handle store has LIFECYCLE: monotonic state transitions (`prepared` → `previewed` → `sent`), discriminated-union result types for both lookup AND transitions, lazy TTL eviction on access (NOT on a sweep). Closest existing shape is `src/wallet/session-manager.ts`'s cached-topic + listener-driven invalidation, but the store's state-machine discipline is genuinely new.

**Pattern to lock:**
- Monotonic transitions only (research § Pattern 1 line 295-310): `prepared` → `previewed` is allowed; re-preview of an already-`previewed` handle is allowed (idempotent re-pin); `sent` is terminal.
- Lazy TTL eviction on every `lookup()` call. No `setInterval` sweep.
- `_resetHandleStoreForTesting()` clears the Map only — listener / timer state doesn't exist.

## Metadata

**Analog search scope:**
- `src/chains/` (RPC client patterns)
- `src/config/` (env accessors — extension of Phase 3's `getWalletConnectProjectId` + `isDemoMode`)
- `src/tools/` (tool registration, handler shapes, format-fanout templates, errorCode envelopes)
- `src/diagnostics/` (logging)
- `src/ens/` (thin SDK wrappers)
- `src/pricing/` (cached service with reset helper + HTTP `fetch` + `log("warn", ...)` on error)
- `src/wallet/` (session-manager state, error classes, `findLiveSession` helper)
- `test/` (test conventions, mock shapes, fake-timer setup)
- `test/helpers/` (factory shape — `mock-sign-client.ts` is the precedent)

**Files scanned:** 19 source files (full read) + 8 test files (full or partial read) + 3 planning docs + 2 ADRs.

**Confidence:**
- Tool / config / test patterns: HIGH — direct mirror of established Phase 2 + Phase 3 conventions; multiple analogs converged on the same shape.
- Handle store + state machine: MEDIUM — no codebase precedent, but research § Pattern 1 supplies the verbatim TS-strict-mode implementation with verified type shapes.
- Fixture-anchored crypto tests: HIGH — research § Code Example 1/2 supply the expected bytes computed end-to-end against the installed `viem@2.48.11`; the fixture is deterministic.
- Schema-level enum gate: HIGH — `ajv` behavior on `enum` is canonical; Phase 4 is the first to use it but the SDK already runs `ajv` at the boundary.
- AbortController timeout: HIGH — vetted Node 18+ pattern from the WHATWG fetch spec; vitest fake-timers play nicely with `setTimeout` + `clearTimeout`.
- Integration test composing helpers: MEDIUM — no codebase precedent, but the composition pattern is standard vitest practice; the Wave 0 helpers fully decouple the fixture from the mocked SDK shape.

**Pattern extraction date:** 2026-05-12

## PATTERN MAPPING COMPLETE
